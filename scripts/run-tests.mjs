// Test runner: bundles every src/**/*.test.ts(x) with esbuild (resolving the
// "@/" path alias the way Vite does), then hands the output to Node's built-in
// test runner. No extra dependencies — esbuild already ships with Vite.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const outDir = path.join(root, ".test-build");

/** Recursively collect files matching a predicate. */
function walk(dir, pred, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, pred, acc);
    else if (pred(full)) acc.push(full);
  }
  return acc;
}

const testFiles = walk(srcDir, (f) => /\.test\.tsx?$/.test(f));
if (testFiles.length === 0) {
  console.error("No test files found (src/**/*.test.ts[x]).");
  process.exit(1);
}

// Resolve "@/..." imports to real files under src/, so esbuild can bundle them
// instead of treating them as external packages.
const aliasPlugin = {
  name: "alias-at",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => {
      const rel = args.path.slice(2);
      for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
        const candidate = path.join(srcDir, rel + ext);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { path: candidate };
        }
      }
      return { errors: [{ text: `Cannot resolve alias import "${args.path}"` }] };
    });
  },
};

fs.rmSync(outDir, { recursive: true, force: true });

await build({
  entryPoints: testFiles,
  outdir: outDir,
  outbase: srcDir,
  bundle: true,
  platform: "node",
  format: "esm",
  // Leave real npm packages (react, zustand, framer-motion, ...) for Node to
  // resolve at runtime; only our own "@/" + relative source gets bundled.
  packages: "external",
  plugins: [aliasPlugin],
  jsx: "automatic",
  sourcemap: "inline",
  logLevel: "warning",
});

const builtTests = walk(outDir, (f) => /\.test\.js$/.test(f));
const result = spawnSync(process.execPath, ["--test", ...builtTests], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status ?? 1);
