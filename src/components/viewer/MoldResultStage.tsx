"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Rig } from "./ViewerCanvas";
import { MM_TO_SCENE, useSTLGeometry } from "./useSTLGeometry";

/**
 * Mold result stage (mold-studio ticket 13, port per research ticket 08):
 * the engine's STL parts reconstructed into the assembled mold.
 *
 * Assembly reconstruction (exact inverse of the engine's print bake):
 *   quaternion = Quaternion(print.q).invert()        // q is [x,y,z,w]
 *   position   = assembly_center − invQ · bboxCenter
 * Explode: each part moves along normalize(assembly_center − mean(centers))
 * by `explode/100 · diag · 0.55`. The silicone skin STL is exported in the
 * assembly frame already — identity transform.
 */

export interface MoldArtifactFile {
  name: string;
  role: string;
  bytes: number;
  url: string;
}

export interface MoldPrintPart {
  name: string;
  q?: number[];
  dims?: number[];
  assembly_center?: number[];
}

const PART_COLORS = ["#6b3d48", "#507567", "#b78978", "#3d1f27"];

interface PlacedPart {
  name: string;
  url: string;
  color: string;
  quaternion: THREE.Quaternion;
  position: THREE.Vector3;
  explodeDir: THREE.Vector3;
  centerMm: THREE.Vector3;
}

function PartMesh({
  part,
  explodeMm,
}: {
  part: PlacedPart;
  explodeMm: number;
}) {
  const geometry = useSTLGeometry(part.url);
  const position = useMemo(() => {
    const p = part.position.clone();
    if (explodeMm > 0) p.addScaledVector(part.explodeDir, explodeMm);
    return p;
  }, [part, explodeMm]);

  return (
    <mesh geometry={geometry} quaternion={part.quaternion} position={position}>
      <meshStandardMaterial
        color={part.color}
        roughness={0.55}
        metalness={0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function SkinMesh({ url, color }: { url: string; color: string }) {
  const geometry = useSTLGeometry(url);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        roughness={0.4}
        metalness={0}
        transparent
        opacity={0.35}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function MoldResultStage({
  files,
  printParts,
  explode,
  showSkin,
  skinColor,
}: {
  files: MoldArtifactFile[];
  printParts: MoldPrintPart[];
  /** 0..100 slider */
  explode: number;
  showSkin: boolean;
  skinColor: string;
}) {
  const printByName = useMemo(
    () => new Map(printParts.map((p) => [p.name, p])),
    [printParts],
  );

  const { parts, skin, frame } = useMemo(() => {
    const skin = files.find((f) => f.role === "skin") ?? null;
    const rawParts = files.filter((f) => f.role === "part");

    const placed: PlacedPart[] = [];
    const box = new THREE.Box3();
    for (const [i, f] of rawParts.entries()) {
      const pp = printByName.get(f.name);
      // Without print data the STL is already in print orientation; show it
      // as-is (still explodes along Y).
      const q = pp?.q ?? [0, 0, 0, 1];
      const invQ = new THREE.Quaternion(q[0], q[1], q[2], q[3]).invert();
      const ac = new THREE.Vector3(
        ...(pp?.assembly_center ?? [0, 0, 0]),
      );
      const dims = pp?.dims ?? [40, 40, 40];
      // bboxCenter of the part in print space ≈ dims/2 (bottom at Z=0).
      const c = new THREE.Vector3(dims[0] / 2, dims[1] / 2, dims[2] / 2);
      const position = ac.clone().sub(c.clone().applyQuaternion(invQ));
      placed.push({
        name: f.name,
        url: f.url,
        color: PART_COLORS[i % PART_COLORS.length],
        quaternion: invQ,
        position,
        explodeDir: new THREE.Vector3(),
        centerMm: ac,
      });
      box.expandByPoint(
        ac.clone().add(new THREE.Vector3(dims[0] / 2, dims[1] / 2, dims[2] / 2)),
      );
      box.expandByPoint(
        ac.clone().sub(new THREE.Vector3(dims[0] / 2, dims[1] / 2, dims[2] / 2)),
      );
    }

    if (placed.length > 1) {
      const mean = placed
        .reduce((v, p) => v.add(p.centerMm), new THREE.Vector3())
        .divideScalar(placed.length);
      for (const p of placed) {
        p.explodeDir
          .copy(p.centerMm)
          .sub(mean)
          .normalize();
        if (!Number.isFinite(p.explodeDir.x)) p.explodeDir.set(0, 1, 0);
      }
    } else if (placed.length === 1) {
      placed[0].explodeDir.set(0, 1, 0);
    }

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const diag = Math.max(size.length(), 1);
    return {
      parts: placed,
      skin,
      frame: {
        radius: (diag / 2) * MM_TO_SCENE,
        targetY: Math.max(center.y, 0) * MM_TO_SCENE,
        diag,
      },
    };
  }, [files, printByName]);

  const explodeMm = (explode / 100) * frame.diag * 0.55;

  return (
    <>
      <group scale={MM_TO_SCENE}>
        {parts.map((p) => (
          <PartMesh key={p.name} part={p} explodeMm={explodeMm} />
        ))}
        {showSkin && skin && (
          <SkinMesh url={skin.url} color={skinColor} />
        )}
      </group>
      <Rig radius={Math.max(frame.radius, 0.1)} targetY={frame.targetY} />
    </>
  );
}
