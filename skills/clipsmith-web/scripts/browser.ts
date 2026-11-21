import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function browserConfigPath(): string {
  return process.env.CLIPSMITH_WEB_BROWSER_CONFIG ||
    join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'clipsmith', 'web-browser.json');
}

export function validateCdpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('CDP URL must be a loopback HTTP origin with an explicit port and no credentials.');
  }
  return url.origin;
}

export async function configuredCdpUrl(): Promise<string | undefined> {
  const explicit = process.env.CLIPSMITH_WEB_CDP_URL?.trim();
  if (explicit) return validateCdpUrl(explicit);
  try {
    const config = JSON.parse(await readFile(browserConfigPath(), 'utf8'));
    if (config.version !== 1 || typeof config.cdp_url !== 'string') {
      throw new Error('Invalid Clipsmith web browser configuration.');
    }
    return validateCdpUrl(config.cdp_url);
  } catch (error: any) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export function verificationMessage(mode: string): string {
  return mode === 'chrome-cdp'
    ? 'Verification challenge in configured Chrome; tab left open for interaction before retrying.'
    : 'Headless browser verification challenge: inspect normal Chrome and configure CDP before declaring a manual blocker.';
}

export async function navigateBrowser(
  session: Awaited<ReturnType<typeof openBrowserPage>>,
  url: string,
) {
  const { page } = session;
  let latest: import('playwright').Response | null = null;
  let commits = 0;
  let responseCommit = 0;
  const committed = (frame: import('playwright').Frame) => {
    if (frame === page.mainFrame()) commits += 1;
  };
  const track = (response: import('playwright').Response) => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      latest = response;
      responseCommit = commits;
    }
  };
  page.on('response', track);
  page.on('framenavigated', committed);
  try {
    const initial = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (!latest) latest = initial;
    if (initial?.headers()['cf-mitigated'] === 'challenge' && session.mode === 'chrome-cdp') {
      // Normal Chrome can complete its own verification without user interaction.
      // Wait for a successful navigation, not merely text painted on a challenge page.
      const deadline = Date.now() + 15_000;
      let verified: import('playwright').Response | null = null;
      while (Date.now() < deadline) {
        const observed = latest as import('playwright').Response | null;
        if (observed && observed !== initial && observed.status() >= 200 && observed.status() < 300 &&
            observed.headers()['cf-mitigated'] !== 'challenge' && commits > responseCommit) {
          await page.waitForLoadState('domcontentloaded', {
            timeout: Math.max(1, Math.min(5_000, deadline - Date.now())),
          });
          if (latest === observed && page.url().split('#')[0] === observed.url().split('#')[0]) {
            verified = observed;
            break;
          }
        }
        await page.waitForTimeout(100);
      }
      // A redirect or an uncommitted response is not proof of a usable document.
      return verified || initial;
    }
    return latest as import('playwright').Response | null;
  } finally {
    page.off('response', track);
    page.off('framenavigated', committed);
  }
}

export async function openBrowserPage() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Missing Playwright runtime: run npm ci in the clipsmith-web skill directory.');
  }
  const cdp = await configuredCdpUrl();
  const browser = cdp
    ? await chromium.connectOverCDP(cdp, { timeout: 10_000 })
    : await chromium.launch({ headless: true });
  try {
    // Use the existing context to retain its browser identity and site session.
    const context = cdp ? browser.contexts()[0] : await browser.newContext({viewport:{width:1365,height:900}});
    if (!context) throw new Error('Connected Chrome has no reusable browser context.');
    const page = await context.newPage();
    return {
      page,
      mode: cdp ? 'chrome-cdp' : 'headless',
      async close({ keepPage = false }: { keepPage?: boolean } = {}) {
        try { if (!keepPage) await page.close(); } finally {
          // For connectOverCDP, close disconnects this client; it does not stop Chrome.
          await browser.close();
        }
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function main() {
  const [action, value] = process.argv.slice(2);
  if (action === 'get') {
    const cdp = await configuredCdpUrl();
    console.log(JSON.stringify({mode:cdp ? 'chrome-cdp':'headless', cdp_url:cdp || null}));
  } else if (action === 'set') {
    const cdp = validateCdpUrl(value || '');
    const path = browserConfigPath();
    await mkdir(dirname(path), {recursive:true});
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({version:1,cdp_url:cdp},null,2)+'\n', {mode:0o600});
    await rename(temporary, path);
    console.log(JSON.stringify({mode:'chrome-cdp',cdp_url:cdp}));
  } else if (action === 'reset') {
    await unlink(browserConfigPath()).catch((error: any) => {if(error.code !== 'ENOENT') throw error;});
    const cdp = await configuredCdpUrl();
    console.log(JSON.stringify({mode:cdp ? 'chrome-cdp':'headless', cdp_url:cdp || null}));
  } else if (action === 'check') {
    const session = await openBrowserPage();
    try { console.log(JSON.stringify({status:'ok',mode:session.mode})); }
    finally { await session.close(); }
  } else {
    throw new Error('Usage: npx tsx scripts/browser.ts get|set <loopback-cdp-url>|reset|check');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {console.error(error.message);process.exitCode=1;});
}
