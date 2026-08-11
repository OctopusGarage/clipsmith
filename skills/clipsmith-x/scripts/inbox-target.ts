// ---------------------------------------------------------------------------
// Inbox auto-target resolver — picks a destination directory for the KB
// capture loop without forcing the caller to pass --bundle-dir every time.
//
// Resolution order:
//   1. $KB_ROOT environment variable → <KB_ROOT>/inbox/<platform>/<leaf>/
//   2. CWD-relative: <cwd>/inbox/<platform>/<leaf>/  — works when the skill
//      is invoked from the social_media_posts project directory
//   3. `alcove kb list --json` finds a registered KB named in $KB_NAME,
//      "social_media_posts", or whose path contains "inbox/social_media"
//      → use its inbox/<platform>/<leaf>/
//   4. null — caller falls back to legacy ~/Downloads/<platform>/<id>/
//
// The resolver is read-only — never creates directories. The skill's
// executor owns ensureDir + writes.
//
// Set KB_NO_AUTO_INBOX=1 to disable all auto-resolution.
// Set KB_NAME=<name> to pick a specific Alcove KB.
// Set KB_ROOT=<abs-path> to point at the knowledge base root directly.
// ---------------------------------------------------------------------------
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFile = promisify(execFileCb);

export type InboxSource = "env" | "cwd" | "alcove";

export interface InboxTarget {
  path: string;
  source: InboxSource;
}

export interface ResolveAutoInboxArgs {
  platform: string;
  /** Pre-computed leaf directory name, e.g. "wechat-GOEzsD5doAjp2FZmtXvpIw" or
   *  "<handle>-<tweetId>" for X. Callers compute this with their platform-
   *  specific parser so this helper stays string-typed. */
  leaf: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Try to find a suitable inbox target. Returns null when none of the
 * resolution strategies land on a plausible inbox directory.
 */
export async function resolveAutoInbox(
  args: ResolveAutoInboxArgs
): Promise<InboxTarget | null> {
  const env = args.env ?? process.env;
  const cwd = args.cwd ?? process.cwd();
  const leaf = args.leaf;

  if (env.KB_NO_AUTO_INBOX === "1") return null;

  // 1. $KB_ROOT
  if (env.KB_ROOT) {
    const candidate = joinPath(env.KB_ROOT, "inbox", args.platform, leaf);
    if (isPlausibleInbox(candidate)) return { path: candidate, source: "env" };
  }

  // 2. cwd-relative + ancestor walk-up. We start at the cwd we were given and
  //    walk up until we either (a) find an ancestor that has a plausible
  //    inbox/<platform>/ subtree, or (b) hit the FS root. This handles the
  //    common case where the caller is invoking the skill from inside its
  //    own skill directory (process.cwd() reflects that) — the KB inbox
  //    lives several levels up.
  for (const root of ancestorDirs(cwd)) {
    const candidate = joinPath(root, "inbox", args.platform, leaf);
    if (env.DEBUG_INBOX) {
      console.error(`[inbox-target] cwd-walk: ${candidate} plausible=${isPlausibleInbox(candidate)}`);
    }
    if (isPlausibleInbox(candidate)) return { path: candidate, source: "cwd" };
  }

  // 3. `alcove kb list --json` lookup (best-effort, async subprocess)
  const alcoveHit = await tryAlcoveLookup(args.platform, leaf, env);
  if (alcoveHit) return alcoveHit;

  return null;
}

/**
 * Yield every directory from `start` walking up to `/`. The first emitted
 * entry is `start` itself; the last is the filesystem root.
 */
function* ancestorDirs(start: string): Generator<string> {
  let current = start;
  while (true) {
    yield current;
    const parent = parentOf(current);
    if (parent === current) return;
    current = parent;
  }
}

function parentOf(p: string): string {
  // POSIX-only; this skill targets macOS / Linux. Avoid the URL constructor
  // since it normalizes ".." away.
  if (!p || p === "/") return "/";
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "/";
  return p.slice(0, idx) || "/";
}

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function isPlausibleInbox(path: string): boolean {
  // We want either:
  //   (a) the path itself already exists (a previous bundle was here)
  //   (b) some ancestor exists and ends in `inbox` or `inbox/<platform>`
  // The leaf may not exist yet — that's fine, the caller creates it.
  if (existsSync(path)) return true;
  if (hasInboxAncestor(path)) return true;
  return false;
}

function hasInboxAncestor(path: string): boolean {
  const parts = path.split("/");
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const candidate = parts.slice(0, i).join("/");
    if (!existsSync(candidate)) continue;
    // We want a path that ends in /inbox or /inbox/<platform>
    if (/\/inbox$/.test(candidate)) return true;
    if (/\/inbox\/[^/]+$/.test(candidate)) return true;
  }
  return false;
}

async function tryAlcoveLookup(
  platform: string,
  leaf: string,
  env: NodeJS.ProcessEnv
): Promise<InboxTarget | null> {
  try {
    const { stdout } = await execFile(
      "uv",
      ["run", "alcove", "kb", "list", "--json"],
      { timeout: 4000, env }
    );
    const list = JSON.parse(stdout) as Array<{ name: string; path: string }>;
    const match =
      list.find((k) => k.name === env.KB_NAME) ??
      list.find((k) => k.name === "social_media_posts") ??
      list.find((k) => /inbox.*social_media|\/social_media_posts/.test(k.path));
    if (!match) return null;
    const candidate = joinPath(expandHome(match.path), "inbox", platform, leaf);
    if (isPlausibleInbox(candidate)) return { path: candidate, source: "alcove" };
    return null;
  } catch {
    return null;
  }
}

function expandHome(p: string): string {
  if (!p.startsWith("~")) return p;
  return p.replace(/^~/, process.env.HOME ?? "");
}
