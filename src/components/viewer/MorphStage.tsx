"use client";

import { useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { cubic } from "maath/easing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  PLANE_LIFT,
  PLANE_MAX_H,
  PLANE_MAX_W,
  fallbackPixelGrid,
  loadImagePixels,
} from "./imagePixels";
import { sampleSurfacePoints } from "./sampleSurface";
import { useGLBModel } from "./useGLBModel";
import { Rig } from "./ViewerCanvas";

/**
 * One-shot 2D→3D transition (ticket 14, rank-1 pattern of issue 04):
 * pixel-grid particles (colored by the image) converge onto the GLB surface
 * in a vertex shader (uniform uProgress — zero CPU per-particle work), the
 * solid mesh crossfades in, a gentle scale-pop lands, then the stage reports
 * completion for the OrbitControls handoff. Total ≤ 4s; guarded to play once.
 */

/** Inside the 30–80k safe budget for iGPUs (issue 04). */
const POINT_COUNT = 42000;
/** Phase lengths (issue 04 staging table): morph 1.8s + pop 0.9s + settle. */
const MORPH_S = 1.8;
const POP_S = 0.9;
const POP_START_S = MORPH_S * 0.75;
const SETTLE_S = 0.35;
/** Scale-pop origin (cubic.out from 0.92). */
const BASE_SCALE = 0.92;

/** Camera framing for the morph — covers the image plane and the model. */
export const MORPH_FRAMING = {
  radius: Math.hypot(PLANE_MAX_W / 2, PLANE_MAX_H / 2 + PLANE_LIFT) + 0.05,
  targetY: PLANE_MAX_H / 2,
};

function createPointsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    uniforms: {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: 0.011 },
      uScale: { value: 600 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aTarget;
      attribute float aRand;
      uniform float uProgress;
      uniform float uTime;
      uniform float uSize;
      uniform float uScale;
      varying vec3 vColor;
      varying float vFade;

      void main() {
        // Staggered per-particle convergence, eased locally (smoothstep).
        float local = clamp(uProgress * 1.35 - aRand * 0.35, 0.0, 1.0);
        float eased = local * local * (3.0 - 2.0 * local);
        vec3 p = mix(position, aTarget, eased);

        // Mid-flight arc: the picture lifts "out of the frame" toward the viewer.
        float mid = sin(eased * 3.14159265);
        p.z += mid * (0.22 + 0.35 * aRand);
        p.y += mid * 0.08 * (aRand - 0.5);

        // Ambient drift while waiting (continuous subtle motion, issue 04).
        float idle = (1.0 - eased) * (1.0 - uProgress);
        p += idle * 0.012 * vec3(
          sin(uTime * 1.3 + aRand * 61.0),
          cos(uTime * 1.1 + aRand * 47.0),
          sin(uTime * 0.9 + aRand * 83.0)
        );

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * (1.0 + 0.6 * mid) * uScale / max(0.05, -mv.z), 1.5, 22.0);

        vColor = color;
        // Particles dissolve as the solid mesh arrives.
        vFade = 1.0 - smoothstep(0.72, 1.0, uProgress);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vFade;

      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float soft = smoothstep(0.5, 0.3, d);
        float alpha = vFade * soft;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });
}

function applyMeshOpacity(root: THREE.Object3D, opacity: number): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.Material & { opacity: number; depthWrite: boolean };
      if (!mat) continue;
      const transparent = opacity < 0.999;
      if (mat.transparent !== transparent) {
        mat.transparent = transparent;
        mat.needsUpdate = true;
      }
      mat.opacity = opacity;
      mat.depthWrite = !transparent;
    }
  });
}

export function MorphStage({
  glbUrl,
  imageUrl,
  onComplete,
}: {
  glbUrl: string;
  imageUrl: string;
  onComplete: () => void;
}) {
  const model = useGLBModel(glbUrl);
  const texture = useTexture(imageUrl);
  const material = useMemo(createPointsMaterial, []);
  const popRef = useRef<THREE.Group>(null);
  const planeMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const tRef = useRef(0);
  const finishedRef = useRef(false);
  const [points, setPoints] = useState<THREE.BufferGeometry | null>(null);

  // Point-size projection scale (fov 45): pixels per world unit at z = 1.
  const viewportHeight = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  useEffect(() => {
    material.uniforms.uScale.value =
      (viewportHeight * dpr * 0.5) / Math.tan(THREE.MathUtils.degToRad(22.5));
  }, [viewportHeight, dpr, material]);

  useEffect(() => () => material.dispose(), [material]);

  // Texture housekeeping: sRGB for the color map.
  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
  }, [texture]);

  // Build the particle system once: pixel grid (start) + surface samples
  // (target). Sampling runs after the pixel grid resolves so both arrays
  // share one count.
  useEffect(() => {
    let cancelled = false;
    let geometry: THREE.BufferGeometry | null = null;
    void (async () => {
      const grid =
        (await loadImagePixels(imageUrl, POINT_COUNT)) ??
        fallbackPixelGrid(POINT_COUNT);
      if (cancelled) return;
      const targets = sampleSurfacePoints(model.root, grid.count);

      // Pre-compensate the 0.92 pop scale so the rendered start grid lands
      // exactly on the image plane.
      const comp = 1 / BASE_SCALE;
      const start = new Float32Array(grid.positions.length);
      for (let i = 0; i < start.length; i++) start[i] = grid.positions[i] * comp;

      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(start, 3));
      geometry.setAttribute("aTarget", new THREE.BufferAttribute(targets, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(grid.colors, 3));
      const rand = new Float32Array(grid.count);
      for (let i = 0; i < rand.length; i++) rand[i] = Math.random();
      geometry.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 4);
      setPoints(geometry);
    })();
    return () => {
      cancelled = true;
      geometry?.dispose();
    };
  }, [model, imageUrl]);

  const aspect =
    texture.image && "width" in texture.image
      ? (texture.image as HTMLImageElement).naturalWidth /
        Math.max(1, (texture.image as HTMLImageElement).naturalHeight)
      : 1;
  const planeW = aspect >= 1 ? PLANE_MAX_W : PLANE_MAX_W * aspect;
  const planeH = aspect >= 1 ? PLANE_MAX_W / aspect : PLANE_MAX_H;

  useFrame((_, delta) => {
    const t = (tRef.current += Math.min(delta, 0.05));
    const morphP = THREE.MathUtils.clamp(t / MORPH_S, 0, 1);
    const eased = morphP * morphP * (3 - 2 * morphP);
    material.uniforms.uProgress.value = eased;
    material.uniforms.uTime.value = t;

    // Image plane dissolves early; particles carry the picture forward.
    if (planeMatRef.current) {
      const planeOpacity = 1 - THREE.MathUtils.smoothstep(morphP, 0, 0.45);
      planeMatRef.current.opacity = planeOpacity;
      planeMatRef.current.visible = planeOpacity > 0.01;
    }

    // Solid mesh fades in over the back half of the morph.
    applyMeshOpacity(model.root, THREE.MathUtils.smoothstep(morphP, 0.55, 1));

    // Gentle scale-pop: cubic.out from 0.92 (issue 04 final staging).
    const popT = THREE.MathUtils.clamp((t - POP_START_S) / POP_S, 0, 1);
    popRef.current?.scale.setScalar(BASE_SCALE + (1 - BASE_SCALE) * cubic.out(popT));

    if (!finishedRef.current && t >= POP_START_S + POP_S + SETTLE_S) {
      finishedRef.current = true; // one-shot guard — never replays on re-render
      onComplete();
    }
  });

  return (
    <>
      {/* Image plane (fades out during the morph) — outside the pop group. */}
      <mesh position={[0, planeH / 2 + PLANE_LIFT, -0.85]}>
        <planeGeometry args={[planeW, planeH]} />
        <meshBasicMaterial
          ref={planeMatRef}
          map={texture}
          transparent
          toneMapped={false}
        />
      </mesh>

      {/* Particles + arriving mesh share the pop group. */}
      <group ref={popRef}>
        <primitive object={model.root} />
        {points && (
          <points geometry={points} material={material} frustumCulled={false} />
        )}
      </group>

      <Rig radius={MORPH_FRAMING.radius} targetY={MORPH_FRAMING.targetY} />
    </>
  );
}
