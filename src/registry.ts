/**
 * Index derived from scanning the registry directory.
 *
 * Source of truth is the headers on disk: every scan rebuilds the
 * catalog from files with valid names and headers. `index.json` is a
 * cache that additionally preserves `lastUsed` across rebuilds.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseHeader, validateFileName } from "./header.ts";

export interface Entry {
  description: string;
  usage: string | null;
  path: string;
  updatedAt: string;
  lastUsed: string | null;
}

export interface IndexFile {
  version: 1;
  scripts: Record<string, Entry>;
}

export const INDEX_NAME = "index.json";

export function emptyIndex(): IndexFile {
  return { version: 1, scripts: {} };
}

export function loadIndex(dir: string): IndexFile | null {
  try {
    const raw = readFileSync(join(dir, INDEX_NAME), "utf8");
    const parsed = JSON.parse(raw) as IndexFile;
    if (parsed?.version !== 1 || typeof parsed.scripts !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveIndex(dir: string, index: IndexFile): void {
  writeFileSync(join(dir, INDEX_NAME), JSON.stringify(index, null, 2) + "\n", "utf8");
}

/** Rebuild the catalog from disk, preserving lastUsed from prev. */
export function buildIndex(dir: string, prev: IndexFile | null): IndexFile {
  const next = emptyIndex();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return next;
  }
  for (const base of names) {
    if (base === INDEX_NAME) continue;
    if (validateFileName(base) !== null) continue;
    const path = join(dir, base);
    try {
      if (!statSync(path).isFile()) continue;
      const parsed = parseHeader(readFileSync(path, "utf8"));
      if ("error" in parsed) continue;
      const name = base.replace(/\.(py|sh)$/, "");
      next.scripts[name] = {
        description: parsed.header.purpose,
        usage: parsed.header.usage,
        path,
        updatedAt: statSync(path).mtime.toISOString(),
        lastUsed: prev?.scripts[name]?.lastUsed ?? null,
      };
    } catch {
      continue;
    }
  }
  return next;
}

export function touchUsed(dir: string, name: string): boolean {
  const prev = loadIndex(dir);
  if (!prev?.scripts[name]) return false;
  prev.scripts[name].lastUsed = new Date().toISOString();
  try {
    saveIndex(dir, prev);
    return true;
  } catch {
    return false;
  }
}

export function formatCatalog(index: IndexFile): string {
  const names = Object.keys(index.scripts).sort();
  if (names.length === 0) {
    return "scriptbox: registry empty — no indexed scripts.";
  }
  return names.map((n) => `${n} — ${index.scripts[n].description}`).join("\n");
}

/** Find a registered script name referenced inside a shell command. */
export function matchInvocation(command: string, dir: string, index: IndexFile): string | null {
  if (!command.includes(dir)) return null;
  for (const name of Object.keys(index.scripts)) {
    if (command.includes(`${name}.py`) || command.includes(`${name}.sh`)) return name;
  }
  return null;
}
