"use client";

import * as THREE from "three";
import { useEffect } from "react";
import { Rig } from "./ViewerCanvas";
import { useViewerParams } from "./params-store";
import { useGLBModel } from "./useGLBModel";

/**
 * Final 3D stage (ticket 14): the normalized GLB standing on the grid, with
 * the ViewerParams panel driving a uniform display scale (sizeCm / 10cm
 * baseline) and tinting the material with the chosen silicone color. The rig
 * re-frames as the slider resizes the model.
 */

export function GlbStage({ glbUrl }: { glbUrl: string }) {
  const model = useGLBModel(glbUrl);
  const params = useViewerParams();

  // Uniform display scale: the slider is centimetres, 10 cm = baseline.
  const scale = params.sizeCm / 10;

  // Silicone palette tints the GLB material(s).
  useEffect(() => {
    model.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (mat && "color" in mat) mat.color.set(params.color);
      }
    });
  }, [model, params.color]);

  return (
    <>
      <group scale={scale}>
        <primitive object={model.root} />
      </group>
      <Rig radius={model.radius * scale} targetY={(model.height * scale) / 2} />
    </>
  );
}
