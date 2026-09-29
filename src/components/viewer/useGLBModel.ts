"use client";

import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * GLB loader (ticket 14) — carried over from the engine viewer architecture
 * (MOLDGENRATOR src/ui/Viewer.tsx): props-in, no store, no mold-specific
 * knowledge. drei's useGLTF caches per URL; we deep-own a clone (geometry +
 * materials) so disposal on unmount is safe, then normalize: centered on X/Z,
 * standing on the grid plane (min.y = 0), bounding sphere scaled to
 * TARGET_RADIUS.
 */

export const TARGET_RADIUS = 0.75;

export interface NormalizedModel {
  /** Normalized root group — add with <primitive object={...} />. */
  root: THREE.Group;
  /** Bounding-sphere radius after normalization (always TARGET_RADIUS). */
  radius: number;
  /** Height after normalization (drives camera framing). */
  height: number;
}

export function useGLBModel(url: string): NormalizedModel {
  const gltf = useGLTF(url);

  const model = useMemo<NormalizedModel>(() => {
    const source: THREE.Object3D =
      (gltf as { scene?: THREE.Object3D }).scene ??
      (gltf as { scenes?: THREE.Object3D[] }).scenes?.[0] ??
      new THREE.Group();
    const clone = source.clone(true);

    // Own the clone's GPU resources so unmount can dispose without touching
    // drei's loader cache.
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      mesh.geometry = mesh.geometry.clone();
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => m.clone());
      } else if (mesh.material) {
        mesh.material = (mesh.material as THREE.Material).clone();
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1e-4);
    const scale = TARGET_RADIUS / radius;

    clone.scale.setScalar(scale);
    clone.position.set(
      -center.x * scale,
      -box.min.y * scale,
      -center.z * scale,
    );

    const root = new THREE.Group();
    root.add(clone);
    return { root, radius: TARGET_RADIUS, height: Math.max(size.y * scale, 1e-4) };
  }, [gltf]);

  useEffect(() => {
    const owned = model.root;
    return () => {
      owned.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const m of mats) m?.dispose();
      });
    };
  }, [model]);

  return model;
}
