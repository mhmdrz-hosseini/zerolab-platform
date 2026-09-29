// Typed window events for the 3D flow (ticket 14).
//
// ThreeDFlow (controller) → ViewerPlaceholder (viewer host) via
// `zl:threed-state`; the host's MorphStage reports back through
// `zl:threed-morph-done`. Kept separate from lab-bus.ts so the shared bus
// contract (tickets 12–15) stays untouched.

export type ThreedPhase =
  | "idle" // no 3D task — plain image plane (ticket 13 state)
  | "wait" // queued/running — image plane + hologram scan loop
  | "locked" // 402 — Persian lock banner
  | "failed" // grey dissolve + retry/back
  | "morph" // one-shot point-cloud morph (≤ 4s)
  | "done"; // final GLB + OrbitControls

export interface ThreedStateDetail {
  phase: ThreedPhase;
  taskId?: string;
  glbUrl?: string;
  imageUrl?: string;
  sample?: boolean;
}

const STATE_EVENT = "zl:threed-state";
const MORPH_DONE_EVENT = "zl:threed-morph-done";

export function emitThreedState(detail: ThreedStateDetail): void {
  window.dispatchEvent(new CustomEvent<ThreedStateDetail>(STATE_EVENT, { detail }));
}

export function onThreedState(
  handler: (detail: ThreedStateDetail) => void,
): () => void {
  const listener = (e: Event) =>
    handler((e as CustomEvent<ThreedStateDetail>).detail);
  window.addEventListener(STATE_EVENT, listener);
  return () => window.removeEventListener(STATE_EVENT, listener);
}

export function emitMorphDone(taskId: string): void {
  window.dispatchEvent(
    new CustomEvent(MORPH_DONE_EVENT, { detail: { taskId } }),
  );
}

export function onMorphDone(
  handler: (detail: { taskId: string }) => void,
): () => void {
  const listener = (e: Event) =>
    handler((e as CustomEvent<{ taskId: string }>).detail);
  window.addEventListener(MORPH_DONE_EVENT, listener);
  return () => window.removeEventListener(MORPH_DONE_EVENT, listener);
}
