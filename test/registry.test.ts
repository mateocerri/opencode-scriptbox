import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIndex,
  formatCatalog,
  loadIndex,
  matchInvocation,
  saveIndex,
  touchUsed,
} from "../src/registry.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scriptbox-reg-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const GOOD_PY = `"""purpose: Compare screenshots.\nusage: python3 png-compare.py A B\n"""\n`;
const NO_HEADER = `import sys\nprint(sys.argv)\n`;

describe("buildIndex", () => {
  it("indexes valid scripts, ignores the rest (closed world)", () => {
    writeFileSync(join(dir, "png-compare.py"), GOOD_PY);
    writeFileSync(join(dir, "scratch.py"), NO_HEADER);
    writeFileSync(join(dir, "tmp-1.py"), GOOD_PY);
    writeFileSync(join(dir, "notes.txt"), GOOD_PY);
    const idx = buildIndex(dir, null);
    assert.deepEqual(Object.keys(idx.scripts), ["png-compare"]);
    assert.equal(idx.scripts["png-compare"].description, "Compare screenshots.");
  });
  it("preserves lastUsed across rebuilds", () => {
    writeFileSync(join(dir, "png-compare.py"), GOOD_PY);
    saveIndex(dir, {
      version: 1,
      scripts: {
        "png-compare": {
          description: "old",
          usage: null,
          path: join(dir, "png-compare.py"),
          updatedAt: "2020-01-01T00:00:00.000Z",
          lastUsed: "2024-05-05T00:00:00.000Z",
        },
      },
    });
    const idx = buildIndex(dir, loadIndex(dir));
    assert.equal(idx.scripts["png-compare"].lastUsed, "2024-05-05T00:00:00.000Z");
    assert.equal(idx.scripts["png-compare"].description, "Compare screenshots.");
  });
});

describe("touchUsed + matchInvocation", () => {
  it("bumps lastUsed only for indexed scripts referenced with dir", () => {
    writeFileSync(join(dir, "png-compare.py"), GOOD_PY);
    saveIndex(dir, buildIndex(dir, null));
    assert.equal(touchUsed(dir, "png-compare"), true);
    assert.equal(touchUsed(dir, "ghost"), false);
    const idx = loadIndex(dir);
    assert.ok(idx?.scripts["png-compare"].lastUsed);
    assert.equal(matchInvocation(`python3 ${dir}/png-compare.py a b`, dir, idx!), "png-compare");
    assert.equal(matchInvocation("python3 /elsewhere/png-compare.py a", dir, idx!), null);
    assert.equal(matchInvocation("ls -la", dir, idx!), null);
  });
});

describe("formatCatalog", () => {
  it("renders one line per script, empty state otherwise", () => {
    writeFileSync(join(dir, "png-compare.py"), GOOD_PY);
    const cat = formatCatalog(buildIndex(dir, null));
    assert.ok(cat.includes("png-compare — Compare screenshots."));
    assert.ok(formatCatalog(buildIndex(mkdtempSync(join(tmpdir(), "sb-empty-")), null)).includes("empty"));
  });
});
