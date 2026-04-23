import { useState } from "react";
import { useStore, type ReducedMotionSetting } from "@/store/useStore";

type ThemeChoice = "system" | "light" | "dark";

const THEMES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const MOTION_OPTIONS: ReadonlyArray<{
  value: ReducedMotionSetting;
  label: string;
  hint: string;
}> = [
  { value: "auto", label: "Auto", hint: "Follow system preference" },
  { value: "on", label: "Reduce", hint: "Minimise animations" },
  { value: "off", label: "Full", hint: "Always animate" },
];

export default function Settings() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const setReducedMotion = useStore((s) => s.setReducedMotion);
  const hapticsEnabled = useStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useStore((s) => s.setHapticsEnabled);
  const resetHistory = useStore((s) => s.resetHistory);
  const resetTutorials = useStore((s) => s.resetTutorials);
  const historyCount = useStore((s) => s.history.length);
  const dailyCount = useStore((s) => s.dailyResults.length);

  const [confirming, setConfirming] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const onResetClick = () => {
    if (!confirming) {
      setConfirming(true);
      window.setTimeout(() => setConfirming(false), 4000);
      return;
    }
    resetHistory();
    setConfirming(false);
    setResetDone(true);
    window.setTimeout(() => setResetDone(false), 2000);
  };

  return (
    <main className="mx-auto w-full max-w-2xl safe-px py-6 sm:py-10" data-testid="settings-page">
      <header className="mb-6">
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Preferences and data. Stored locally in your browser.
        </p>
      </header>

      <div className="space-y-5">
        <Section title="Appearance" description="Light, dark, or follow your system.">
          <Segmented
            testId="theme-segmented"
            value={theme}
            options={THEMES}
            onChange={(v) => setTheme(v)}
          />
        </Section>

        <Section
          title="Motion"
          description="Reduce movement across transitions, game feedback, and the Daily Challenge hero."
        >
          <Segmented
            testId="motion-segmented"
            value={reducedMotion}
            options={MOTION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => setReducedMotion(v)}
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {MOTION_OPTIONS.find((o) => o.value === reducedMotion)?.hint}
          </p>
        </Section>

        <Section
          title="Haptics"
          description="Vibration feedback on mobile devices. Has no effect on desktop."
        >
          <Toggle
            testId="haptics-toggle"
            checked={hapticsEnabled}
            onChange={setHapticsEnabled}
            label={hapticsEnabled ? "Haptics on" : "Haptics off"}
          />
        </Section>

        <Section
          title="Data"
          description={`${historyCount} play record${historyCount === 1 ? "" : "s"} · ${dailyCount} daily result${dailyCount === 1 ? "" : "s"}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onResetClick}
              data-testid="reset-history"
              aria-label={
                confirming
                  ? "Confirm reset — click again to wipe history"
                  : "Reset history"
              }
              className={
                "rounded-xl px-3 py-2 text-sm font-semibold transition-colors " +
                (confirming
                  ? "bg-rose-600 text-white hover:bg-rose-500"
                  : "bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700")
              }
            >
              {confirming ? "Tap again to confirm" : "Reset history"}
            </button>
            <button
              type="button"
              onClick={() => resetTutorials()}
              data-testid="reset-tutorials"
              className="rounded-xl bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Show tutorials again
            </button>
            {resetDone && (
              <span
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-300"
                data-testid="reset-done"
              >
                Cleared.
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Reset history wipes best scores, play history, and daily streaks. Tutorials and settings are kept.
          </p>
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 sm:p-5">
      <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {description}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      data-testid={testId}
      className="inline-flex rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            data-value={o.value}
            data-active={active ? 1 : 0}
            className={
              "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors " +
              (active
                ? "bg-white text-slate-900 shadow-soft dark:bg-slate-900 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      data-checked={checked ? 1 : 0}
      onClick={() => onChange(!checked)}
      className={
        "inline-flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors " +
        (checked
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-800"
          : "bg-slate-100 text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700")
      }
    >
      <span
        aria-hidden
        className={
          "relative inline-block h-5 w-9 rounded-full transition-colors " +
          (checked ? "bg-emerald-500" : "bg-slate-400 dark:bg-slate-600")
        }
      >
        <span
          className={
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all " +
            (checked ? "left-[18px]" : "left-0.5")
          }
        />
      </span>
      {label}
    </button>
  );
}
