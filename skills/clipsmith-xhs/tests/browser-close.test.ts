import assert from "node:assert/strict";
import { test } from "node:test";
import { closeBrowserProcessOverCdp } from "../scripts/core";

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
