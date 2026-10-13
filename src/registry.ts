/**
 * Live-scan registry: the catalog is derived from disk on every call.
 *
 * Roots: the user registry always, plus a per-project overlay resolved
 * from the server working directory — `<cwd>/.opencode/scripts` by
 * default, `<cwd>/scripts` only behind `scanWorkdirScripts` (a bare
 * scripts/ dir in a third-party repo can otherwise inject purpose lines
 * into every session). No index file to drift; usage stats live in the
 * user dir `usage.json`, maintained solely by the plugin.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseHeader, validateFileName } from "./header.ts";

export type Origin = "user" | "project";

export interface Entry {
  description: string;
  usage: string | null;
  path: string;
  updatedAt: string;
  origin: Origin;
}

export interface Root {
  dir: string;
  origin: Origin;
}

export interface ScanResult {
  scripts: Record<string, Entry>;
  /** Files skipped: bad name, bad header, unreadable, not a file. */
  ignored: number;
}

export const USAGE_NAME = "usage.json";
export const MAX_SESSIONS = 20;

export interface ScriptStats {
  uses: number;
  lastUsed: string;
}

export interface SessionStats {
  lastSeen: string;
  saves: number;
  lists: number;
  shows: number;
  /** Shell invocations matched to a registry script. */
  matches: number;
}

export interface UsageTotals {
  saves: number;
  lists: number;
  shows: number;
  matches: number;
  uses: number;
}

interface UsageFile {
  version: 2;
  scripts: Record<string, ScriptStats>;
  sessions: Record<string, SessionStats>;
  totals: UsageTotals;
}

function zeroSession(now: string): SessionStats {
  return { lastSeen: now, saves: 0, lists: 0, shows: 0, matches: 0 };
}

function defaultUsage(): UsageFile {
  return {
    version: 2,
    scripts: {},
    sessions: {},
    totals: { saves: 0, lists: 0, shows: 0, matches: 0, uses: 0 },
  };
}

function evictSessions(usage: UsageFile): void {
  const ids = Object.keys(usage.sessions).sort((a, b) =>
    usage.sessions[a].lastSeen.localeCompare(usage.sessions[b].lastSeen),
  );
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SESSIONS))) {
    delete usage.sessions[id];
  }
}

function writeUsage(userDir: string, usage: UsageFile): boolean {
  try {
    mkdirSync(userDir, { recursive: true });
    const tmp = join(userDir, `.${USAGE_NAME}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(usage, null, 2) + "\n", "utf8");
    renameSync(tmp, join(userDir, USAGE_NAME));
    return true;
  } catch {
    return false;
  }
}

/** Scan one directory; invalid files stay invisible (closed world). */
export function scanDir(dir: string, origin: Origin): ScanResult {
  const result: ScanResult = { scripts: {}, ignored: 0 };
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return result;
  }
  for (const base of names) {
    if (base === USAGE_NAME) continue;
    if (validateFileName(base) !== null) {
      result.ignored++;
      continue;
    }
    const path = join(dir, base);
    try {
      if (!statSync(path).isFile()) {
        result.ignored++;
        continue;
      }
      const parsed = parseHeader(readFileSync(path, "utf8"));
      if ("error" in parsed) {
        result.ignored++;
        continue;
      }
      const name = base.replace(/\.(py|sh)$/, "");
      result.scripts[name] = {
        description: parsed.header.purpose,
        usage: parsed.header.usage,
        path,
        updatedAt: statSync(path).mtime.toISOString(),
        origin,
      };
    } catch {
      result.ignored++;
    }
  }
  return result;
}

/**
 * Merge roots in order; later roots win on name collision (project
 * shadows user: more specific context wins).
 */
export function scanRoots(roots: Root[]): ScanResult {
  const merged: ScanResult = { scripts: {}, ignored: 0 };
  for (const root of roots) {
    const r = scanDir(root.dir, root.origin);
    Object.assign(merged.scripts, r.scripts);
    merged.ignored += r.ignored;
  }
  return merged;
}

/**
 * Validate and store a script. Atomic write (temp + rename) so a crash
 * never leaves a half-written file in the registry.
 */
export function saveScript(
  dir: string,
  filename: string,
  content: string,
): { name: string; purpose: string } | { error: string } {
  const badName = validateFileName(filename);
  if (badName) return { error: badName };
  const parsed = parseHeader(content);
  if ("error" in parsed) return { error: parsed.error };
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${filename}.${process.pid}.tmp`);
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, join(dir, filename));
  } catch (err) {
    return { error: `cannot write ${filename}: ${String(err)}` };
  }
  return { name: filename.replace(/\.(py|sh)$/, ""), purpose: parsed.header.purpose };
}

function loadUsage(userDir: string): UsageFile {
  try {
    const parsed = JSON.parse(readFileSync(join(userDir, USAGE_NAME), "utf8")) as
      | UsageFile
      | { version: 1; used: Record<string, string> };
    if (parsed?.version === 2 && typeof parsed === "object") {
      const v2 = parsed as UsageFile;
      if (
        typeof v2.scripts === "object" &&
        typeof v2.sessions === "object" &&
        typeof v2.totals === "object"
      ) {
        return v2;
      }
      throw new Error("bad shape");
    }
    // v1 migration: stamps become single-use entries.
    if (parsed?.version === 1 && typeof (parsed as { used?: unknown }).used === "object") {
      const usage = defaultUsage();
      for (const [key, stamp] of Object.entries(
        (parsed as { used: Record<string, string> }).used,
      )) {
        if (typeof stamp === "string") usage.scripts[key] = { uses: 1, lastUsed: stamp };
      }
      return usage;
    }
    throw new Error("bad version");
  } catch {
    return defaultUsage();
  }
}

function usageKey(entry: Entry, name: string): string {
  return `${entry.origin}:${name}`;
}

/**
 * Best-effort usage stamp. Without a session id it keeps the legacy
 * behavior (lastUsed only). With one it also bumps the per-script use
 * counter and the session's match bucket. Never throws.
 */
export function recordUse(
  userDir: string,
  entry: Entry,
  name: string,
  sessionID?: string,
  now = new Date().toISOString(),
): boolean {
  try {
    const usage = loadUsage(userDir);
    const key = usageKey(entry, name);
    const stats = usage.scripts[key] ?? { uses: 0, lastUsed: now };
    stats.lastUsed = now;
    usage.scripts[key] = stats;
    if (typeof sessionID === "string" && sessionID) {
      stats.uses += 1;
      usage.totals.uses += 1;
      const session = usage.sessions[sessionID] ?? zeroSession(now);
      session.lastSeen = now;
      session.matches += 1;
      usage.sessions[sessionID] = session;
      usage.totals.matches += 1;
      evictSessions(usage);
    }
    return writeUsage(userDir, usage);
  } catch {
    return false;
  }
}

/**
 * Count a registry tool call (save/list/show) in the session bucket and
 * totals. Only wired when the `metrics` option is on. Never throws.
 */
export function recordToolCall(
  userDir: string,
  sessionID: string,
  tool: "save" | "list" | "show",
  now = new Date().toISOString(),
): boolean {
  try {
    if (!sessionID || typeof sessionID !== "string") return false;
    const usage = loadUsage(userDir);
    const session = usage.sessions[sessionID] ?? zeroSession(now);
    session.lastSeen = now;
    session[`${tool}s` as "saves" | "lists" | "shows"] += 1;
    usage.sessions[sessionID] = session;
    usage.totals[`${tool}s` as "saves" | "lists" | "shows"] += 1;
    evictSessions(usage);
    return writeUsage(userDir, usage);
  } catch {
    return false;
  }
}

export function lastUsed(userDir: string, entry: Entry, name: string): string | null {
  try {
    return loadUsage(userDir).scripts[usageKey(entry, name)]?.lastUsed ?? null;
  } catch {
    return null;
  }
}

/** Read-only snapshot of the metrics (empty store when metrics are off). */
export function readMetrics(userDir: string): UsageFile {
  try {
    return loadUsage(userDir);
  } catch {
    return defaultUsage();
  }
}

export function formatCatalog(result: ScanResult, userDir: string): string {
  const names = Object.keys(result.scripts).sort();
  if (names.length === 0) {
    return "scriptbox: registry empty — save a script, then reuse it by name.";
  }
  const lines = names.map((n) => {
    const e = result.scripts[n];
    const used = lastUsed(userDir, e, n);
    const tag = e.origin === "project" ? " [project]" : "";
    return `${n}${tag} — ${e.description}${used ? ` (last used ${used})` : ""}`;
  });
  if (result.ignored > 0) {
    lines.push(`(${result.ignored} file(s) ignored: bad name or header)`);
  }
  return lines.join("\n");
}

/** Find an indexed script name referenced inside a shell command. */
export function matchInvocation(
  command: string,
  catalog: ScanResult,
): { entry: Entry; name: string } | null {
  for (const name of Object.keys(catalog.scripts)) {
    const e = catalog.scripts[name];
    if (!command.includes(e.path)) continue;
    if (command.includes(`${name}.py`) || command.includes(`${name}.sh`)) {
      return { entry: e, name };
    }
  }
  return null;
}
