/**
 * Live-scan registry: the catalog is derived from disk on every call.
 *
 * There is no index file to drift out of sync. Usage stats live in
 * `usage.json`, maintained solely by the plugin — never a manual step.
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

export interface Entry {
  description: string;
  usage: string | null;
  path: string;
  updatedAt: string;
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

/** Derive the catalog from files on disk. Invalid files stay invisible. */
export function scan(dir: string): ScanResult {
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
      };
    } catch {
      result.ignored++;
    }
  }
  return result;
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

function loadUsage(dir: string): UsageFile {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, USAGE_NAME), "utf8")) as UsageFile;
    if (parsed?.version !== 1 || typeof parsed.used !== "object") throw new Error("bad");
    return parsed;
  } catch {
    return { version: 1, used: {} };
  }
}

/** Best-effort usage stamp. Never throws. */
export function recordUse(dir: string, name: string): boolean {
  try {
    const usage = loadUsage(dir);
    usage.used[name] = new Date().toISOString();
    writeFileSync(join(dir, USAGE_NAME), JSON.stringify(usage, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

export function lastUsed(dir: string, name: string): string | null {
  try {
    return loadUsage(dir).used[name] ?? null;
  } catch {
    return null;
  }
}

export function formatCatalog(scanResult: ScanResult, dir: string): string {
  const names = Object.keys(scanResult.scripts).sort();
  if (names.length === 0) {
    return "scriptbox: registry empty — save a script, then reuse it by name.";
  }
  const lines = names.map((n) => {
    const used = lastUsed(dir, n);
    return `${n} — ${scanResult.scripts[n].description}${used ? ` (last used ${used})` : ""}`;
  });
  if (scanResult.ignored > 0) {
    lines.push(`(${scanResult.ignored} file(s) ignored: bad name or header)`);
  }
  return lines.join("\n");
}

/** Find an indexed script name referenced inside a shell command. */
export function matchInvocation(command: string, dir: string, names: string[]): string | null {
  if (!command.includes(dir)) return null;
  for (const name of names) {
    if (command.includes(`${name}.py`) || command.includes(`${name}.sh`)) return name;
  }
  return null;
}
