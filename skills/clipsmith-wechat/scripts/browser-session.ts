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
  slowMo?: number;
  log: (message: string) => void;
  chromiumImpl?: typeof chromium;
}

export function defaultBrowserMode(value: string | undefined): BrowserMode {
  const normalized = (value || "headless").trim().toLowerCase();
  if (normalized === "headless" || normalized === "headed" || normalized === "cdp") {
    return normalized;
  }
  throw new Error(`Unsupported browser_mode: ${value}`);
}

export async function openBrowserSession(
  args: OpenBrowserSessionArgs
): Promise<BrowserSession> {
  const chromiumApi = args.chromiumImpl ?? chromium;

  if (args.mode === "cdp") {
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
  args.log(`[browser] launching ${args.mode} persistent context: ${args.profileDir}`);
  const context = await chromiumApi.launchPersistentContext(args.profileDir, {
    headless,
    args: ["--no-proxy-server"],
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
