import { useEffect, useState } from "react";

/** The non-standard event Chromium fires when the app is installable. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallState = {
  /** Chromium captured an install prompt — show a real "Install" button. */
  canInstall: boolean;
  /** iOS Safari never fires the prompt — show a "how to" hint instead. */
  iosHint: boolean;
  /** Trigger the native install prompt (no-op when not available). */
  promptInstall: () => Promise<void>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS marks installed web apps with navigator.standalone
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

/**
 * Wraps the `beforeinstallprompt` flow so the UI can offer an install button.
 * On platforms that don't support it (notably iOS Safari) it reports an
 * `iosHint` so the UI can explain the manual "Add to Home Screen" path.
 */
export function useInstallPrompt(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep Chrome's mini-infobar from auto-showing
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const standalone = isStandalone();
  const isIOS =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent);

  const promptInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } finally {
      setDeferred(null);
    }
  };

  return {
    canInstall: !!deferred && !installed && !standalone,
    iosHint: isIOS && !standalone && !installed,
    promptInstall,
  };
}
