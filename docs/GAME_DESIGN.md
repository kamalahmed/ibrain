# iBrain Game Design Language

This document defines how every iBrain game must look, feel and teach. The
reference implementation is `src/games/AttentionPond.tsx` (the pond) — study
it before building or redesigning a game. The goal is Lumosity-grade feel with
our own art and mechanics: **a friendly illustrated scene, a trivially easy
level 1, one new twist per level, and a tutorial that shows instead of tells.**

## 1. Design pillars

1. **Scene, not form.** The play area is an illustrated SVG scene (like the
   pond: water, lily pads, reeds, fish), not a grid of grey buttons. Game
   objects are characters/props drawn in SVG with soft shapes, 2–3 tone
   fills and subtle idle animation (sway, bob, tail-wag).
2. **Trivially easy start.** Level 1 must be beatable by someone who skipped
   the tutorial: fewest items, slowest pace, single rule. Anyone's first 20
   seconds should produce several successes.
3. **One twist per level.** Each of the 4 levels adds exactly ONE named
   mechanic ("colours appear", "grid grows", "rule now flips"). The
   `LevelComplete` `nextLabel` names the twist.
4. **Juicy, fast feedback.** Every input answers within 100 ms: correct →
   pop/burst + floating `+N` ping (see pond's `Ping`) + `haptic.success()`;
   wrong → short shake / red flash + `haptic.error()`. Feedback never blocks
   the next input.
5. **Show, don't tell.** Tutorials are auto-playing animated demos of real
   gameplay, not paragraphs.

## 2. Technical contract (must hold for every game)

- Phases: `intro → tutorial → countdown → playing ⇄ levelDone → done`.
  Skip tutorial when `tutorialsSeen[id]` is set; mark it seen after.
- Shared components (do not fork): `GameShell` (pass
  `compact={phase === "playing" || phase === "levelDone"}`), `Instructions`,
  `Tutorial`, `Countdown`, `GameHUD`, `LevelComplete`, `ResultsScreen`.
- Session: `SESSION_SECONDS = 180`, exactly 4 levels (`LEVELS` array with
  `id: 1|2|3|4`, `name`), one session timer via `Date.now()` deadline ref +
  200 ms interval; ending at 0 records the score. Clearing level 4 before the
  clock adds remaining seconds as bonus and ends the session.
- Scoring: integer points; `recordPlay(id, finalScore)` exactly once per
  session (guard with `endedRef`). A strong-but-human session should land
  near the game's anchor in `src/lib/scoring.ts` (≈ rating 100).
- HUD `data-testid`s (`score`, `timer`) come from `GameHUD`; keep any extra
  `data-testid` the game already exposes (`progress`, `rule`, `stage`,
  grid/cell ids…) so tests and tooling keep working.
- SSR-safe: the intro phase must render under `renderToString` — no
  `window`/`document`/`Math.random()`-derived layout at module scope; seed
  randomness inside `useState(() => …)` or effects.
- Cleanup: clear every interval/timeout/rAF on unmount (`useEffect` return).
- Reduced motion: looping decorative animation goes through framer-motion
  (`MotionConfig` handles the preference) or is gated by
  `useReducedMotion()`. CSS keyframe loops must be disabled under
  `prefers-reduced-motion` (see `index.css`).
- Mobile first: playable one-handed at 320 px; touch targets ≥ 44 px; the
  scene fits above the fold with the compact shell (max height ≈ 60vh).
- TypeScript strict; no new dependencies.

## 3. The scene spec

- Container: `rounded-3xl` full-width block with a soft per-game gradient
  backdrop (reuse the game's `accent` family from `src/lib/games.ts`),
  `ring-1 ring-slate-200/70 dark:ring-slate-800`, `overflow-hidden`.
- Inside: one `<svg viewBox="0 0 100 100">` (or wider) scene, layered
  back-to-front like the pond: backdrop → props → actors → feedback pings.
- Interactive SVG elements get generous invisible hit areas
  (`<circle r={size*1.6} fill="transparent" />` on top of the visible actor).
- Light AND dark mode must both look intentional (dark: deepen the backdrop
  gradient, keep actors saturated).
- Floating score pings: reuse the pond's pattern — absolutely-positioned
  `+N` / `miss` labels that rise and fade over ~850 ms.

## 4. Tutorial spec

3–5 steps, each `{ caption, stage, auto }`:
- `caption`: ONE sentence, ≤ 90 chars, plain words ("Tap the fish to feed
  it"), no jargon.
- `stage`: a looping, self-playing mini-demo of the real scene (a ghost
  finger/cursor dot moving to the target, the actual success animation
  firing). Build it from the same SVG pieces as the game.
- Steps that demonstrate auto-advance (`auto: 2600–4000`); the final step is
  manual ("I'm ready" button appears when `auto` is omitted).
- Step order: 1) the core action, 2) the goal/what scores, 3) the twist to
  expect at higher levels, 4) (optional) controls recap.

## 5. Difficulty ramp

Design levels so the *median* first-time player clears level 1 in well under
its target and reaches level 3 by session end:
- L1: minimum items, slowest timing, single rule, forgiving penalties.
- L2: +quantity or +pace (still one rule).
- L3: the signature twist (distraction, conjunction, rule flip…).
- L4: twist + pace; this is where experts differentiate.
Mistakes must never feel punishing at L1–L2 (small or no penalty, gentle
shake); introduce real penalties only where the twist demands them.

## 6. Game roster and scene concepts

| id | name | domain | scene concept |
|----|------|--------|---------------|
| reaction | Reaction Time | speed | **Balloon sky**: balloons drift up carrying shapes; pop the one matching the rule banner; hold back when none match. |
| memory | Memory Match | memory | **Picnic table**: illustrated cards flip in 3D on a wooden table; matches sparkle and fly to a collection row. |
| nback | N-Back | memory | **Animal parade**: animals march along a conveyor; press Match when the current animal equals the one N steps back; faded history slots visualise "N back". |
| math | Math Sprint | problem | **Rocket climb**: each correct answer boosts a little rocket up the sky gradient; wrong answers stall it. Answer cards are big and friendly. |
| schulte | Schulte Table | attention | **Constellations**: numbers are stars; tapping in order draws a glowing constellation line; colours become nebulae on later grids. |
| pond | Attention Pond | attention | (Reference art, light polish only: water texture, ripple on tap, shore grass.) |
| stroop | Stroop Test | flexibility | **Paint studio**: the word sits on a paint can; answer by tapping paint splats; correct answers splash the canvas with colour. |
| pattern | Pattern Recall | memory | **Firefly garden**: tiles are stones in a night garden; fireflies light a pattern, then you re-tap it from memory. Grid grows per level. |
| flock | Flock Focus | attention | **Sky flock**: a V of birds flies through the sky; answer the direction the CENTRE bird faces (left/right buttons); flankers turn incongruent on later levels. |
| compare | Quick Compare | problem | **Market scales**: two crates of numbers sit on a balance scale; tap the heavier side (or "equal"); the scale physically tips to reveal the answer. |

## 7. Ship checklist (verify before calling a game done)

- [ ] Intro renders server-side; route loads with no console errors.
- [ ] Tutorial: animated demos, ≤ 90-char captions, skippable.
- [ ] Level 1 winnable immediately; 4 levels; one named twist each.
- [ ] GameHUD + compact shell during play; LevelComplete between levels.
- [ ] Correct/wrong feedback < 100 ms with pings + haptics.
- [ ] Session ends exactly once; `recordPlay` called once; bonus for
      finishing early; score ≈ anchor for a strong run.
- [ ] Dark mode + 320 px mobile verified.
- [ ] All timers/rAF cleaned up on unmount.
