import { useStore } from "@/store/useStore";

export function tap(ms: number | number[] = 10) {
  if (typeof navigator === "undefined") return;
  if (!("vibrate" in navigator)) return;
  if (!useStore.getState().hapticsEnabled) return;
  try {
    navigator.vibrate(ms);
  } catch {
    // ignore
  }
}

export const haptic = {
  tap: () => tap(8),
  success: () => tap([8, 40, 24]),
  error: () => tap([30, 40, 30]),
};
