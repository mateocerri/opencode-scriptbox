import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_SESSIONS,
  formatCatalog,
  lastUsed,
  readMetrics,
  recordToolCall,
  recordUse,
  scanRoots,
  type Entry,
} from "../src/registry.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scriptbox-usage-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ENTRY: Entry = {
  description: "Compare screenshots.",
  usage: null,
  path: "/tmp/png-compare.py",
  updatedAt: "2026-01-01T00:00:00.000Z",
  origin: "user",
};

describe("recordUse", () => {
  it("stamps lastUsed without counters when no session given", () => {
    assert.equal(recordUse(dir, ENTRY, "png-compare"), true);
    assert.ok(lastUsed(dir, ENTRY, "png-compare"));
    const m = readMetrics(dir);
    assert.equal(m.totals.uses, 0);
    assert.deepEqual(Object.keys(m.sessions), []);
  });
  it("bumps per-script and session counters with a session", () => {
    assert.equal(recordUse(dir, ENTRY, "png-compare", "s1"), true);
    assert.equal(recordUse(dir, ENTRY, "png-compare", "s1"), true);
    const m = readMetrics(dir);
    assert.equal(m.scripts["user:png-compare"].uses, 2);
    assert.equal(m.sessions["s1"].matches, 2);
    assert.equal(m.totals.uses, 2);
    assert.equal(m.totals.matches, 2);
  });
  it("migrates v1 stamps to v2 without losing them", () => {
    writeFileSync(
      join(dir, "usage.json"),
      JSON.stringify({ version: 1, used: { "user:old": "2026-02-02T00:00:00.000Z" } }),
    );
    assert.equal(lastUsed(dir, { ...ENTRY, origin: "user" }, "old"), "2026-02-02T00:00:00.000Z");
    assert.equal(recordUse(dir, ENTRY, "png-compare", "s1"), true);
    const m = readMetrics(dir);
    assert.equal(m.version, 2);
    assert.equal(m.scripts["user:old"].uses, 1);
    assert.equal(m.scripts["user:png-compare"].uses, 1);
  });
});

describe("recordToolCall", () => {
  it("counts save/list/show per session and totals, rejects empty sessions", () => {
    assert.equal(recordToolCall(dir, "", "list"), false);
    assert.equal(recordToolCall(dir, "s1", "save"), true);
    assert.equal(recordToolCall(dir, "s1", "list"), true);
    assert.equal(recordToolCall(dir, "s2", "show"), true);
    const m = readMetrics(dir);
    assert.equal(m.sessions["s1"].saves, 1);
    assert.equal(m.sessions["s1"].lists, 1);
    assert.equal(m.sessions["s2"].shows, 1);
    assert.equal(m.totals.saves, 1);
    assert.equal(m.totals.lists, 1);
    assert.equal(m.totals.shows, 1);
  });
  it("evicts oldest sessions beyond the cap, keeps totals", () => {
    for (let i = 0; i < MAX_SESSIONS + 3; i++) {
      const now = `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`;
      assert.equal(recordToolCall(dir, `s${i}`, "list", now), true);
    }
    const m = readMetrics(dir);
    assert.equal(Object.keys(m.sessions).length, MAX_SESSIONS);
    assert.equal(m.sessions["s0"], undefined);
    assert.equal(m.totals.lists, MAX_SESSIONS + 3);
  });
});

describe("formatCatalog with v2 store", () => {
  it("still renders last-used from the migrated store", () => {
    writeFileSync(join(dir, "png-compare.py"), `"""purpose: Compare screenshots.\n"""\n`);
    recordUse(dir, { ...ENTRY, path: join(dir, "png-compare.py") }, "png-compare", "s1");
    const cat = formatCatalog(scanRoots([{ dir, origin: "user" }]), dir);
    assert.ok(cat.includes("png-compare — Compare screenshots."));
    assert.ok(cat.includes("last used"));
  });
});
