import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultBrowserMode,
  openBrowserSession,
} from "../scripts/browser-session";

test("WeChat defaults to short-lived headless browser mode", () => {
  assert.equal(defaultBrowserMode(undefined), "headless");
  assert.equal(defaultBrowserMode(""), "headless");
  assert.equal(defaultBrowserMode("headed"), "headed");
  assert.equal(defaultBrowserMode("cdp"), "cdp");
});

test("WeChat rejects unknown browser modes", () => {
  assert.throws(
    () => defaultBrowserMode("daemon"),
    /Unsupported browser_mode: daemon/
  );
});

test("headless mode closes the launched persistent context", async () => {
  const events: string[] = [];
  const fakeChromium = {
    launchPersistentContext: async () => ({
      pages: () => [],
      newPage: async () => ({ url: () => "about:blank" }),
      close: async () => events.push("context.close"),
    }),
  };

  const session = await openBrowserSession({
    mode: "headless",
    profileDir: "/tmp/clipsmith-wechat-profile",
    cdpPort: "9223",
    keepOpen: false,
    slowMo: 0,
    log: (message) => events.push(message),
    chromiumImpl: fakeChromium as never,
  });

  assert.equal(session.mode, "headless");
  await session.close();
  assert.deepEqual(events.filter((item) => item === "context.close"), ["context.close"]);
});

test("headed mode can leave provider-owned browser open for inspection", async () => {
  const events: string[] = [];
  const fakeChromium = {
    launchPersistentContext: async () => ({
      pages: () => [],
      newPage: async () => ({ url: () => "about:blank" }),
      close: async () => events.push("context.close"),
    }),
  };

  const session = await openBrowserSession({
    mode: "headed",
    profileDir: "/tmp/clipsmith-wechat-profile",
    cdpPort: "9223",
    keepOpen: true,
    slowMo: 25,
    log: (message) => events.push(message),
    chromiumImpl: fakeChromium as never,
  });

  await session.close();
  assert.equal(events.includes("context.close"), false);
  assert.ok(events.some((item) => item.includes("leaving headed browser open")));
});

test("cdp mode disconnects from external Chrome without closing provider-owned context", async () => {
  const events: string[] = [];
  const fakeContext = {
    pages: () => [],
    newPage: async () => ({ url: () => "about:blank" }),
  };
  const fakeChromium = {
    connectOverCDP: async () => ({
      contexts: () => [fakeContext],
      close: async () => events.push("browser.close"),
    }),
  };

  const session = await openBrowserSession({
    mode: "cdp",
    profileDir: "/tmp/clipsmith-wechat-profile",
    cdpPort: "9223",
    keepOpen: false,
    slowMo: 0,
    log: (message) => events.push(message),
    chromiumImpl: fakeChromium as never,
  });

  assert.equal(session.mode, "cdp");
  await session.close();
  assert.deepEqual(events.filter((item) => item === "browser.close"), ["browser.close"]);
  assert.ok(events.some((item) => item.includes("external Chrome")));
});
