import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useInstallPrompt } from "@/lib/useInstallPrompt";

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3v10m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * An in-app install entry point. Browsers don't render an install button on
 * the page themselves — Chromium hides it in a menu, iOS has none at all — so
 * we surface our own. Renders nothing when the app is already installed or
 * can't be installed.
 */
export function InstallButton() {
  const { canInstall, iosHint, promptInstall } = useInstallPrompt();
  const [showHelp, setShowHelp] = useState(false);

  if (!canInstall && !iosHint) return null;

  const pill =
    "inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-500";

  if (canInstall) {
    return (
      <button
        type="button"
        onClick={promptInstall}
        className={pill}
        data-testid="install-button"
      >
        <DownloadIcon />
        <span>Install</span>
      </button>
    );
  }

  // iOS Safari: no programmatic prompt — explain the manual path.
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowHelp((v) => !v)}
        className={pill}
        aria-expanded={showHelp}
        data-testid="install-button"
      >
        <DownloadIcon />
        <span>Install</span>
      </button>
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 top-full z-40 mt-2 w-60 rounded-2xl bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-soft ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
            role="dialog"
          >
            To install iBrain on iPhone or iPad: tap the{" "}
            <strong className="text-slate-900 dark:text-white">Share</strong>{" "}
            icon in Safari, then{" "}
            <strong className="text-slate-900 dark:text-white">
              “Add to Home Screen.”
            </strong>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
