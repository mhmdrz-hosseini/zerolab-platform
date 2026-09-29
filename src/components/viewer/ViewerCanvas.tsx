"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, type ReactNode } from "react";
import * as THREE from "three";

/**
 * Viewer canvas architecture carried over from the engine viewer
 * (MOLDGENRATOR src/ui/Viewer.tsx): R3F Canvas, fov-45 camera, hemisphere +
 * directional lights, background color, gridHelper, drei OrbitControls with
 * damping ~0.08. Props-in, no store — stages mount `Rig` themselves with
 * their own bounds (the engine's auto-framing pattern).
 */

const BG = "#f5f0eb"; // lab paper — continuous with the HTML states

/** Auto-framing rig (engine `Rig`): frame `radius` around `targetY`. */
export function Rig({ radius, targetY }: { radius: number; targetY: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as {
    target: THREE.Vector3;
    update: () => void;
  } | null;

  useEffect(() => {
    const r = Math.max(radius, 0.05);
    camera.position.set(r * 0.55, targetY + r * 0.42, r * 1.6);
    camera.near = Math.max(0.01, r / 80);
    camera.far = Math.max(40, r * 60);
    camera.updateProjectionMatrix();
    controls?.target.set(0, targetY, 0);
    controls?.update();
  }, [radius, targetY, camera, controls]);

  return null;
}

export function ViewerCanvas({
  children,
  controlsEnabled,
}: {
  children: ReactNode;
  /** OrbitControls handoff — enabled only after the morph settles. */
  controlsEnabled: boolean;
}) {
  return (
    <Canvas
      camera={{ fov: 45, near: 0.05, far: 60, position: [0.4, 0.4, 1.3] }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
    >
      <color attach="background" args={[BG]} />
      <hemisphereLight args={["#ffffff", "#dfe5ee", 1.1]} />
      <directionalLight position={[1.8, 2.6, 1.6]} intensity={1.7} />
      <directionalLight position={[-1.6, 0.8, -1.4]} intensity={0.45} />
      <gridHelper args={[6, 24, "#d9cbc2", "#e9ddd4"]} />
      {children}
      <OrbitControls
        makeDefault
        enabled={controlsEnabled}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={0.35}
        maxDistance={8}
      />
    </Canvas>
  );
}
