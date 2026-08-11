import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProxyMode = "none" | "system" | "custom";

export interface CdpProbeDeps {
  fetchImpl?: typeof fetch;
}

export interface EnsureCdpChromeArgs extends CdpProbeDeps {
  port: string;
  userDataDir: string;
  log: (message: string) => void;
  autolaunch?: boolean;
  proxyMode?: string;
  proxyServer?: string;
  timeoutMs?: number;
}

type BrowserCloseWebSocket = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
};

type BrowserCloseWebSocketConstructor = new (url: string) => BrowserCloseWebSocket;

export interface CloseBrowserProcessOverCdpDeps extends CdpProbeDeps {
  WebSocketImpl?: BrowserCloseWebSocketConstructor;
}

export function getChromeProxyArgs(
  proxyModeRaw: string | undefined,
  proxyServerRaw: string | undefined
): string[] {
  const proxyMode = (proxyModeRaw || "none").trim().toLowerCase();
  if (proxyMode === "none") {
    return ["--no-proxy-server"];
  }
  if (proxyMode === "system") {
    return [];
  }
  if (proxyMode === "custom") {
    const proxyServer = (proxyServerRaw || "").trim();
    if (!proxyServer) {
      throw new Error("proxy_server is required when proxy_mode=custom");
    }
    return [`--proxy-server=${proxyServer}`];
  }
  throw new Error(`Unsupported proxy_mode: ${proxyMode}. Expected one of: none, system, custom`);
}

export async function probeCdpEndpoint(
  port: string,
  deps: CdpProbeDeps = {}
): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 1500);
    const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    const json = (await response.json()) as { Browser?: string };
    return typeof json.Browser === "string" && json.Browser.length > 0;
  } catch {
    return false;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function waitForCdpEndpoint(
  port: string,
  timeoutMs: number,
  deps: CdpProbeDeps = {}
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeCdpEndpoint(port, deps)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export async function ensureCdpChrome(args: EnsureCdpChromeArgs): Promise<void> {
  if (await probeCdpEndpoint(args.port, args)) {
    args.log(`Reuse Chrome remote debugging session on :${args.port}`);
    return;
  }

  if (args.autolaunch === false) {
    throw new Error(
      `No Chrome DevTools Protocol listener on http://localhost:${args.port}. ` +
        `Launch Chrome with --remote-debugging-port=${args.port} first, or enable autolaunch.`
    );
  }

  const chromeArgs = [
    "-na",
    "Google Chrome",
    "--args",
    `--remote-debugging-port=${args.port}`,
    `--user-data-dir=${args.userDataDir}`,
    ...getChromeProxyArgs(args.proxyMode, args.proxyServer),
  ];
  args.log(`Launch Chrome remote debugging session: open ${chromeArgs.join(" ")}`);
  await execFileAsync("open", chromeArgs, {
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });

  const ready = await waitForCdpEndpoint(args.port, args.timeoutMs ?? 20000, args);
  if (!ready) {
    throw new Error(
      `Chrome CDP endpoint not ready on :${args.port} after launch. Start manually: open -na "Google Chrome" --args --remote-debugging-port=${args.port} --user-data-dir=${args.userDataDir}`
    );
  }
}

export async function closeBrowserProcessOverCdp(
  port: string,
  log: (message: string) => void,
  deps: CloseBrowserProcessOverCdpDeps = {}
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`);
  if (!response.ok) {
    throw new Error(`CDP endpoint on :${port} returned HTTP ${response.status}`);
  }

  const version = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!version.webSocketDebuggerUrl) {
    throw new Error(`CDP endpoint on :${port} did not expose webSocketDebuggerUrl`);
  }

  const WebSocketCtor = deps.WebSocketImpl ?? globalThis.WebSocket;
  if (!WebSocketCtor) {
    throw new Error("WebSocket is not available in this Node.js runtime");
  }

  log(`closing Chrome remote debugging session on :${port}`);
  await new Promise<void>((resolveClose, rejectClose) => {
    const socket = new WebSocketCtor(version.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      rejectClose(new Error(`Timed out while closing Chrome on :${port}`));
    }, 5000);

    socket.onopen = () => {
      socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { id?: number; error?: unknown };
        if (payload.id !== 1) {
          return;
        }
        clearTimeout(timeout);
        if (payload.error) {
          rejectClose(new Error(`Browser.close failed: ${JSON.stringify(payload.error)}`));
          return;
        }
        resolveClose();
      } catch (error) {
        clearTimeout(timeout);
        rejectClose(error instanceof Error ? error : new Error(String(error)));
      }
    };
    socket.onerror = (event) => {
      clearTimeout(timeout);
      rejectClose(new Error(`WebSocket error while closing Chrome: ${String(event)}`));
    };
    socket.onclose = () => {
      clearTimeout(timeout);
      resolveClose();
    };
  });
}
