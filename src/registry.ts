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

interface UsageFile {
  version: 1;
  used: Record<string, string>;
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
    const parsed = JSON.parse(readFileSync(join(userDir, USAGE_NAME), "utf8")) as UsageFile;
    if (parsed?.version !== 1 || typeof parsed.used !== "object") throw new Error("bad");
    return parsed;
  } catch {
    return { version: 1, used: {} };
  }
}

function usageKey(entry: Entry, name: string): string {
  return `${entry.origin}:${name}`;
}

/** Best-effort usage stamp. Never throws. */
export function recordUse(userDir: string, entry: Entry, name: string): boolean {
  try {
    const usage = loadUsage(userDir);
    usage.used[usageKey(entry, name)] = new Date().toISOString();
    writeFileSync(join(userDir, USAGE_NAME), JSON.stringify(usage, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

export function lastUsed(userDir: string, entry: Entry, name: string): string | null {
  try {
    return loadUsage(userDir).used[usageKey(entry, name)] ?? null;
  } catch {
    return null;
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
