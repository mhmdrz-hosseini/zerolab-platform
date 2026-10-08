"use client";

import { useLoader } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

/**
 * STL geometry loader (mold-studio ticket 13) — the MoldForge outputs are
 * binary STLs in millimetres, Z-up, baked bottom-at-Z=0 in print orientation
 * (research ticket 08). Per-part normalization is FORBIDDEN: the assembly and
 * bed reconstruction need the true mm coordinates; the parent group applies
 * the single MM_TO_SCENE scale.
 */

export const MM_TO_SCENE = 0.01; // 1 scene unit = 10 cm (GlbStage baseline)

export function useSTLGeometry(url: string): THREE.BufferGeometry {
  const geo = useLoader(STLLoader, url);
  return useMemo(() => {
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }, [geo]);
}
