import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import App from "@/App";
import { GAMES } from "@/lib/games";

// Server-render every route through the real App tree. This catches the whole
// class of "the page is blank / the button goes nowhere" bugs: broken imports,
// undefined components, and crashes on first render.
const ROUTES = [
  "/",
  "/dashboard",
  "/daily",
  "/settings",
  "/this-route-does-not-exist",
  ...GAMES.map((g) => g.path),
];

for (const route of ROUTES) {
  test(`route "${route}" renders without throwing`, () => {
    const html = ReactDOMServer.renderToString(
      createElement(
        MemoryRouter,
        { initialEntries: [route] },
        createElement(App)
      )
    );
    assert.ok(html.length > 0, `"${route}" produced empty markup`);
  });
}
