"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Rig } from "./ViewerCanvas";
import { useSTLGeometry } from "./useSTLGeometry";
import {
  LAYOUT_GAP,
  PLATE_MARGIN,
  REF_BED,
  layoutPrintBed,
} from "@/lib/bed-layout";

/**
 * Manager-only print-bed view (mold-studio ticket 15): the mold parts laid
 * out on the virtual 220×220 plate in their baked print orientation (the
 * engine exports STLs bottom-at-Z=0 in that frame — bed view simply positions
 * them; the whole group rotates to Y-up with the print-frame convention).
 */

export interface BedPartInput {
  name: string;
  dims: [number, number, number];
  url: string;
  color: string;
}

const PRINT_ROT: [number, number, number] = [-Math.PI / 2, 0, 0];

function BedPartMesh({
  part,
  x,
  y,
}: {
  part: BedPartInput;
  x: number;
  y: number;
}) {
  const geometry = useSTLGeometry(part.url);
  // STL is Z-up mm, bottom baked at Z=0. PRINT_ROT maps local +Z (height) to
  // scene +Y; local bed-Y therefore maps to scene -Z (position mirrors it).
  return (
    <mesh
      geometry={geometry}
      rotation={PRINT_ROT}
      position={[x + part.dims[0] / 2, 0, -(y + part.dims[1] / 2)]}
    >
      <meshStandardMaterial
        color={part.color}
        roughness={0.6}
        metalness={0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function MoldBedStage({ parts }: { parts: BedPartInput[] }) {
  const layout = useMemo(
    () => layoutPrintBed(parts.map((p) => ({ name: p.name, dims: p.dims }))),
    [parts],
  );
  const byName = useMemo(
    () => new Map(parts.map((p) => [p.name, p])),
    [parts],
  );
  const placedParts = layout.placed
    .map((p) => ({ slot: p, part: byName.get(p.name) }))
    .filter((x): x is { slot: (typeof layout.placed)[number]; part: BedPartInput } =>
      Boolean(x.part),
    );

  const bedScene = REF_BED * 0.01; // mm → scene (MM_TO_SCENE scale)
  const radius = bedScene * 0.75;

  return (
    <>
      <group scale={0.01} rotation={[0, 0, 0]}>
        {/* plate */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[REF_BED / 2, 0, -REF_BED / 2]}>
          <planeGeometry args={[REF_BED, REF_BED]} />
          <meshStandardMaterial color="#ede5de" roughness={0.9} />
        </mesh>
        {/* frame */}
        <lineSegments
          rotation={[-Math.PI / 2, 0, 0]}
          position={[REF_BED / 2, 0.3, -REF_BED / 2]}
        >
          <edgesGeometry args={[new THREE.PlaneGeometry(REF_BED, REF_BED)]} />
          <lineBasicMaterial color="#6b3d48" />
        </lineSegments>
        {/* margin guide */}
        <lineSegments
          rotation={[-Math.PI / 2, 0, 0]}
          position={[REF_BED / 2, 0.3, -REF_BED / 2]}
        >
          <edgesGeometry
            args={[
              new THREE.PlaneGeometry(
                REF_BED - 2 * PLATE_MARGIN,
                REF_BED - 2 * PLATE_MARGIN,
              ),
            ]}
          />
          <lineBasicMaterial color="#cdbbb8" />
        </lineSegments>
        {placedParts.map(({ slot, part }) => (
          <BedPartMesh key={slot.name} part={part} x={slot.x} y={slot.y} />
        ))}
      </group>
      <Rig radius={radius} targetY={0} />
    </>
  );
}
