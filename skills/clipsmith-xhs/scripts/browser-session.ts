import { chromium, type Browser, type BrowserContext } from "playwright";

export type BrowserMode = "headless" | "headed" | "cdp";

export interface BrowserSession {
  mode: BrowserMode;
  context: BrowserContext;
  close(): Promise<void>;
}

export interface OpenBrowserSessionArgs {
  mode: BrowserMode;
  profileDir: string;
  cdpPort: string;
  keepOpen: boolean;
  proxyMode?: string;
  proxyServer?: string;
  slowMo?: number;
  log: (message: string) => void;
  chromiumImpl?: typeof chromium;
  ensureCdpReady?: () => Promise<void>;
}

const DEFAULT_PROXY_MODE = "none";

export function defaultBrowserMode(value: string | undefined): BrowserMode {
  const normalized = (value || "cdp").trim().toLowerCase();
  if (normalized === "headless" || normalized === "headed" || normalized === "cdp") {
    return normalized;
  }
  throw new Error(`Unsupported browser_mode: ${value}`);
}

function getChromeProxyArgs(
  proxyModeRaw: string | undefined,
  proxyServerRaw: string | undefined
): string[] {
  const proxyMode = (proxyModeRaw || DEFAULT_PROXY_MODE).trim().toLowerCase();
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

export async function openBrowserSession(
  args: OpenBrowserSessionArgs
): Promise<BrowserSession> {
  const chromiumApi = args.chromiumImpl ?? chromium;

  if (args.mode === "cdp") {
    if (args.ensureCdpReady) {
      await args.ensureCdpReady();
    }
    args.log(`[browser] attaching to external Chrome over CDP on :${args.cdpPort}`);
    const browser: Browser = await chromiumApi.connectOverCDP(
      `http://127.0.0.1:${args.cdpPort}`
    );
    const context = browser.contexts()[0] ?? (await browser.newContext());
    return {
      mode: "cdp",
      context,
      close: async () => {
        args.log(
          "[browser] disconnecting from external Chrome; the Chrome process stays alive"
        );
        await browser.close().catch(() => undefined);
      },
    };
  }

  const headless = args.mode === "headless";
  args.log(`[browser] launching experimental ${args.mode} persistent context: ${args.profileDir}`);
  const context = await chromiumApi.launchPersistentContext(args.profileDir, {
    headless,
    args: getChromeProxyArgs(args.proxyMode, args.proxyServer),
    slowMo: args.slowMo && args.slowMo > 0 ? args.slowMo : undefined,
  });

  return {
    mode: args.mode,
    context,
    close: async () => {
      if (args.mode === "headed" && args.keepOpen) {
        args.log("[browser] leaving headed browser open because --keep_open is true");
        return;
      }
      await context.close().catch(() => undefined);
    },
  };
}
