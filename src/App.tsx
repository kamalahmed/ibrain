import { Route, Routes } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import ReactionTime from "./games/ReactionTime";
import MemoryMatch from "./games/MemoryMatch";
import NBack from "./games/NBack";
import MathSprint from "./games/MathSprint";
import SchulteTable from "./games/SchulteTable";

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <div className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/play/reaction" element={<ReactionTime />} />
          <Route path="/play/memory" element={<MemoryMatch />} />
          <Route path="/play/nback" element={<NBack />} />
          <Route path="/play/math" element={<MathSprint />} />
          <Route path="/play/schulte" element={<SchulteTable />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
      <footer className="border-t border-slate-200/70 bg-white/40 py-6 text-center text-xs text-slate-500 backdrop-blur dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-500">
        <p>
          Built with React + Vite · All progress is stored locally in your browser.
        </p>
      </footer>
    </div>
  );
}
