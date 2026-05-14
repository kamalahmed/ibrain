import { useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Navbar } from "./components/Navbar";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Daily from "./pages/Daily";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import ReactionTime from "./games/ReactionTime";
import MemoryMatch from "./games/MemoryMatch";
import NBack from "./games/NBack";
import MathSprint from "./games/MathSprint";
import SchulteTable from "./games/SchulteTable";
import AttentionPond from "./games/AttentionPond";
import Stroop from "./games/Stroop";
import { useStore } from "./store/useStore";

type FramerReducedMotion = "always" | "never" | "user";

function framerReducedMotion(
  setting: "auto" | "on" | "off"
): FramerReducedMotion {
  if (setting === "on") return "always";
  if (setting === "off") return "never";
  return "user";
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <Routes location={location}>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/daily" element={<Daily />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/play/reaction" element={<ReactionTime />} />
          <Route path="/play/memory" element={<MemoryMatch />} />
          <Route path="/play/nback" element={<NBack />} />
          <Route path="/play/math" element={<MathSprint />} />
          <Route path="/play/schulte" element={<SchulteTable />} />
          <Route path="/play/pond" element={<AttentionPond />} />
          <Route path="/play/stroop" element={<Stroop />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  const reducedMotion = useStore((s) => s.reducedMotion);
  const theme = useStore((s) => s.theme);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemPrefersDark(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const isDark =
      theme === "dark" || (theme === "system" && systemPrefersDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, [theme, systemPrefersDark]);

  return (
    <MotionConfig reducedMotion={framerReducedMotion(reducedMotion)}>
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <div className="flex-1">
          <AnimatedRoutes />
        </div>
        <footer className="safe-bottom border-t border-slate-200/70 bg-white/40 pt-6 text-center text-xs text-slate-500 backdrop-blur dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-500">
          <p>
            Built with love by Kamal Ahmed · © 2026 Kamal Ahmed. All rights
            reserved.
          </p>
          <p className="mt-1">
            Your progress is stored locally in your browser.
          </p>
        </footer>
      </div>
    </MotionConfig>
  );
}
