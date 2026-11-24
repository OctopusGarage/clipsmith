import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureCdpChrome,
  closeBrowserProcessOverCdp,
  getChromeProxyArgs,
  probeCdpEndpoint,
} from "../scripts/cdp";

class FakeCloseWebSocket {
  static openedUrl = "";
  static sentMessages: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    FakeCloseWebSocket.openedUrl = url;
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string): void {
    FakeCloseWebSocket.sentMessages.push(data);
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: 1, result: {} }) }), 0);
  }

  close(): void {
    this.onclose?.();
  }
}

test("getChromeProxyArgs maps none/system/custom modes", () => {
  assert.deepEqual(getChromeProxyArgs(undefined, undefined), []);
  assert.deepEqual(getChromeProxyArgs("", undefined), []);
  assert.deepEqual(getChromeProxyArgs("  ", undefined), []);
  assert.deepEqual(getChromeProxyArgs("none", undefined), ["--no-proxy-server"]);
  assert.deepEqual(getChromeProxyArgs("system", undefined), []);
  assert.deepEqual(getChromeProxyArgs("custom", "http://127.0.0.1:7890"), [
    "--proxy-server=http://127.0.0.1:7890",
  ]);
  assert.throws(() => getChromeProxyArgs("custom", undefined), /proxy_server is required/);
});

test("probeCdpEndpoint returns true only for healthy browser endpoints", async () => {
  assert.equal(
    await probeCdpEndpoint("9223", {
      fetchImpl: async () => new Response(JSON.stringify({ Browser: "Chrome/151" })),
    }),
    true
  );
  assert.equal(
    await probeCdpEndpoint("9223", {
      fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
    }),
    false
  );
});

test("probeCdpEndpoint clears timeout when response parsing fails", async () => {
  const activeTimers = new Set<unknown>();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = originalSetTimeout(handler, timeout, ...args);
    activeTimers.add(id);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    activeTimers.delete(id);
    return originalClearTimeout(id);
  }) as typeof clearTimeout;
  try {
    assert.equal(
      await probeCdpEndpoint("9223", {
        fetchImpl: async () =>
          new Response("{", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
      false
    );
    assert.equal(activeTimers.size, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("ensureCdpChrome can fail without autolaunching", async () => {
  await assert.rejects(
    () =>
      ensureCdpChrome({
        port: "9222",
        userDataDir: "/tmp/profile",
        autolaunch: false,
        log: () => undefined,
        fetchImpl: async () => new Response("", { status: 404 }),
      }),
    /No Chrome DevTools Protocol listener/
  );
});

test("closeBrowserProcessOverCdp sends Browser.close to browser websocket", async () => {
  FakeCloseWebSocket.openedUrl = "";
  FakeCloseWebSocket.sentMessages = [];
  const logs: string[] = [];

  await closeBrowserProcessOverCdp("9223", (message) => logs.push(message), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/browser/test",
        }),
        { status: 200 }
      ),
    WebSocketImpl: FakeCloseWebSocket,
  });

  assert.equal(FakeCloseWebSocket.openedUrl, "ws://127.0.0.1:9223/devtools/browser/test");
  assert.deepEqual(FakeCloseWebSocket.sentMessages.map((message) => JSON.parse(message)), [
    { id: 1, method: "Browser.close" },
  ]);
  assert.deepEqual(logs, ["closing Chrome remote debugging session on :9223"]);
});

test("closeBrowserProcessOverCdp rejects when browser websocket URL is missing", async () => {
  await assert.rejects(
    () =>
      closeBrowserProcessOverCdp("9223", () => undefined, {
        fetchImpl: async () => new Response(JSON.stringify({ Browser: "Chrome/151" }), { status: 200 }),
        WebSocketImpl: FakeCloseWebSocket,
      }),
    /did not expose webSocketDebuggerUrl/
  );
});

test("background tab creation selects its own target without activating unrelated tabs", async () => {
  const { createBackgroundPage } = await import("../scripts/cdp");
  const unrelated = { id: "user-tab" };
  const captured = { id: "capture-tab" };
  const calls: unknown[] = [];
  const browserSession = {
    async send(method: string, params: unknown) { calls.push([method, params]); return { targetId: "capture-tab" }; },
    async detach() {},
  };
  const context = {
    browser: () => ({ newBrowserCDPSession: async () => browserSession }),
    pages: () => [unrelated, captured],
    async newCDPSession(page: typeof captured) {
      return { send: async () => ({ targetInfo: { targetId: page.id } }), detach: async () => {} };
    },
  };
  assert.equal(await createBackgroundPage(context), captured);
  assert.deepEqual(calls, [["Target.createTarget", { url: "about:blank", background: true }]]);
});

 test("Chrome launch stays in the background and inherits the system proxy", async () => {
  const { getChromeLaunchArgs } = await import("../scripts/cdp");
  const args = getChromeLaunchArgs({port: "9223", userDataDir: "/tmp/capture-profile"});
  assert.ok(args.indexOf("-g") < args.indexOf("--args"));
  assert.ok(!args.includes("--no-proxy-server"));
  assert.ok(args.includes("--user-data-dir=/tmp/capture-profile"));
 });

test("unattached background targets are closed on timeout without a foreground fallback", async () => {
  const { createBackgroundPage } = await import("../scripts/cdp");
  const calls: string[] = [];
  const session = {
    async send(method: string) { calls.push(method); return {targetId: "orphan"}; },
    async detach() { calls.push("detach"); },
  };
  await assert.rejects(createBackgroundPage({
    browser: () => ({newBrowserCDPSession: async () => session}),
    pages: () => [],
    newCDPSession: async () => session,
  }, 0), /did not attach/);
  assert.deepEqual(calls, ["Target.createTarget", "Target.closeTarget", "detach"]);
});
