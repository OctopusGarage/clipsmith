import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultBrowserMode,
  openBrowserSession,
} from "../scripts/browser-session";

test("XHS keeps cdp as the stable default", () => {
  assert.equal(defaultBrowserMode(undefined), "cdp");
  assert.equal(defaultBrowserMode(""), "cdp");
  assert.equal(defaultBrowserMode("headless"), "headless");
  assert.equal(defaultBrowserMode("headed"), "headed");
});

test("XHS rejects unknown browser modes", () => {
  assert.throws(
    () => defaultBrowserMode("always-on"),
    /Unsupported browser_mode: always-on/
  );
});

test("XHS headless mode closes the launched persistent context", async () => {
  const events: string[] = [];
  const fakeChromium = {
    launchPersistentContext: async (_profileDir: string, options: { headless?: boolean }) => {
      events.push(`headless=${String(options.headless)}`);
      return {
        pages: () => [],
        newPage: async () => ({ url: () => "about:blank" }),
        close: async () => events.push("context.close"),
      };
    },
  };

  const session = await openBrowserSession({
    mode: "headless",
    profileDir: "/tmp/clipsmith-xhs-profile",
    cdpPort: "9223",
    keepOpen: false,
    proxyMode: "none",
    log: (message) => events.push(message),
    chromiumImpl: fakeChromium as never,
  });

  assert.equal(session.mode, "headless");
  await session.close();
  assert.ok(events.includes("headless=true"));
  assert.ok(events.includes("context.close"));
});

test("XHS cdp mode attaches to external Chrome and disconnects only", async () => {
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
    profileDir: "/tmp/clipsmith-xhs-profile",
    cdpPort: "9223",
    keepOpen: false,
    proxyMode: "none",
    log: (message) => events.push(message),
    chromiumImpl: fakeChromium as never,
    ensureCdpReady: async () => events.push("ensure-cdp"),
  });

  assert.equal(session.mode, "cdp");
  await session.close();
  assert.ok(events.includes("ensure-cdp"));
  assert.ok(events.includes("browser.close"));
  assert.ok(events.some((item) => item.includes("external Chrome")));
});
