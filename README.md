# 🧠 iBrain — Brain Training Web App

A small Lumosity-style brain training app built with **Vite + React + TypeScript + Tailwind**. Ships five mini-games, a daily streak, a rolled-up "Brain Score", dark mode and local-storage persistence — no backend required.

![iBrain](./public/favicon.svg)

## ✨ Features

- **Landing page** with an intro and a "Start Training" CTA.
- **Dashboard** with all games, best scores, daily streak and an overall Brain Score.
- **5 mini-games**, each with its own route, instructions → countdown → gameplay → results flow:
  1. ⚡️ **Reaction Time** — tap when the screen turns green; 5-trial average.
  2. 🧩 **Memory Match** — 4×4 card flip, match all pairs.
  3. 🧠 **N-Back (2-back)** — working-memory letter sequence; press match when the current letter equals the one 2 steps back.
  4. ➗ **Math Sprint** — 60 seconds of arithmetic; correct answers score, wrong answers cost 3s.
  5. 🔢 **Schulte Table** — tap 1–25 in order on a 5×5 grid.
- **LocalStorage persistence** for best scores, history and streak.
- **Dark mode** with system-preference default and an in-app toggle.
- **Mobile-first, responsive** layouts down to 320 px with touch-friendly 44 px hit targets.
- **Keyboard accessible** — semantic HTML, ARIA labels, visible focus rings, `Space` to "Match" in N-Back, `Enter` to submit in Math Sprint.

## 🚀 Local development

```bash
npm install
npm run dev
```

The dev server is served on `http://localhost:5173`.

```bash
npm run build     # typecheck + production build → dist/
npm run preview   # preview the built app locally
npm run lint      # typecheck only
```

## 🌐 One-click deploy to Vercel

1. Push this repo to GitHub (already configured for a branch-based workflow).
2. Go to [vercel.com/new](https://vercel.com/new) and **Import** the repository.
3. Vercel auto-detects Vite; leave the defaults:
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
4. Click **Deploy**. Every push to `main` redeploys automatically, and preview deployments are created for every PR.

The included [`vercel.json`](./vercel.json) adds an SPA rewrite so client-side React Router routes resolve to `index.html` on direct loads/refreshes.

## 🏠 Hostinger Node.js deployment (later)

When you move to Hostinger's Node.js hosting, serve the built static files via a tiny Express server. For example:

```bash
npm install --production express compression
```

```js
// server.js
import express from "express";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(express.static(path.join(__dirname, "dist"), { maxAge: "1y", index: false }));

// SPA fallback — send all unknown routes to index.html
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`iBrain running on :${PORT}`);
});
```

Deploy steps on Hostinger:

1. Run `npm run build` locally (or in CI) and upload the whole repo (including `dist/`) to Hostinger.
2. In the Hostinger Node.js app settings, set **Application startup file** to `server.js` and **Application root** to the project folder.
3. Run `npm install --production` from the Hostinger shell.
4. Start/Restart the application. Your custom domain will proxy to the Node.js port Hostinger assigns via `process.env.PORT`.

## 🧱 Project structure

```
src/
  components/        Shared UI: GameShell, Countdown, ResultsScreen, Navbar, …
  games/             One file per mini-game
  pages/             Landing, Dashboard, NotFound
  store/useStore.ts  Zustand + localStorage persistence
  lib/               games metadata, scoring, date helpers
```

All progress is stored under the `ibrain:state:v1` key in `localStorage`. Clearing the key resets the app.

## 📜 License

MIT — enjoy, remix, and keep your brain sharp.
