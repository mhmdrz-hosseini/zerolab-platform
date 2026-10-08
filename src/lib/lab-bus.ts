// Shared typed event bus for lab feature slices. Tickets 12/13/14/15 communicate
// through these events instead of importing each other's internals.
// Quota refresh uses the `zl:quota-changed` window event (established by CreditIndicator).

export type LabBusEventMap = {
  // ChatPanel (ticket 12) emits when the user clicks «تولید تصویر»
  "lab:generate-image": { brief: string; chatId?: string };
  // ImageFlow (ticket 13) emits after final standardized confirmation
  "lab:image-selected": { imageId: string; url: string; standardizedUrl: string };
  // Library (ticket 15) emits when the user clicks «افزودن به چت» — the item's
  // url rides along so the chat can attach the image for the vision model.
  "lab:library-add": { item: { id: string; title: string; category: string; description: string; seedPrompt?: string; url: string } };
  // ImageFlow (ticket 13) emits when the 3D step should start with the standardized image
  "lab:make-3d": { imageId: string; url: string };
  // HistoryDrawer (2026-10-05) emits when the user picks a past chat to resume
  "lab:restore-chat": { chatId: string };
};

export function emitLabEvent<K extends keyof LabBusEventMap>(type: K, detail: LabBusEventMap[K]) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

export function onLabEvent<K extends keyof LabBusEventMap>(type: K, handler: (detail: LabBusEventMap[K]) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<LabBusEventMap[K]>).detail);
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}

export function refreshQuotaUI() {
  window.dispatchEvent(new CustomEvent("zl:quota-changed"));
}
