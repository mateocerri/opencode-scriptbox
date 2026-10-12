import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatCatalog,
  lastUsed,
  matchInvocation,
  recordUse,
  saveScript,
  scan,
} from "../src/registry.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scriptbox-reg-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const GOOD_PY = `"""purpose: Compare screenshots.\nusage: python3 png-compare.py A B\n"""\n`;
const NO_HEADER = `import sys\nprint(sys.argv)\n`;

describe("scan", () => {
  it("indexes valid scripts, ignores the rest (closed world)", () => {
    writeFileSync(join(dir, "png-compare.py"), GOOD_PY);
    writeFileSync(join(dir, "scratch.py"), NO_HEADER);
    writeFileSync(join(dir, "tmp-1.py"), GOOD_PY);
    writeFileSync(join(dir, "notes.txt"), GOOD_PY);
    const result = scan(dir);
    assert.deepEqual(Object.keys(result.scripts), ["png-compare"]);
    assert.equal(result.scripts["png-compare"].description, "Compare screenshots.");
    assert.equal(result.ignored, 3);
  });
  it("empty or missing dir scans clean", () => {
    assert.deepEqual(Object.keys(scan(dir).scripts), []);
    assert.deepEqual(Object.keys(scan(join(dir, "nope")).scripts), []);
  });
});

describe("saveScript", () => {
  it("rejects bad names without touching disk", () => {
    const r = saveScript(dir, "Tmp.py", GOOD_PY);
    assert.ok("error" in r);
    assert.equal(existsSync(join(dir, "Tmp.py")), false);
  });
  it("rejects missing purpose without touching disk", () => {
    const r = saveScript(dir, "good-name.py", NO_HEADER);
    assert.ok("error" in r && r.error.includes("purpose"));
    assert.equal(existsSync(join(dir, "good-name.py")), false);
  });
  it("writes valid scripts atomically", () => {
    const r = saveScript(dir, "png-compare.py", GOOD_PY);
    assert.ok(!("error" in r));
    assert.equal(readFileSync(join(dir, "png-compare.py"), "utf8"), GOOD_PY);
    assert.deepEqual(Object.keys(scan(dir).scripts), ["png-compare"]);
  });
});

describe("recordUse + matchInvocation", () => {
  it("stamps usage only for indexed scripts referenced with dir", () => {
    writeFileSync(join(dir, "png-compare.py"), GOOD_PY);
    const names = Object.keys(scan(dir).scripts);
    assert.equal(matchInvocation(`python3 ${dir}/png-compare.py a b`, dir, names), "png-compare");
    assert.equal(matchInvocation("python3 /elsewhere/png-compare.py a", dir, names), null);
    assert.equal(matchInvocation("ls -la", dir, names), null);
    assert.equal(lastUsed(dir, "png-compare"), null);
    assert.equal(recordUse(dir, "png-compare"), true);
    assert.ok(lastUsed(dir, "png-compare"));
  });
});

describe("formatCatalog", () => {
  it("renders one line per script, empty state otherwise", () => {
    writeFileSync(join(dir, "png-compare.py"), GOOD_PY);
    const cat = formatCatalog(scan(dir), dir);
    assert.ok(cat.includes("png-compare — Compare screenshots."));
    assert.ok(formatCatalog(scan(mkdtempSync(join(tmpdir(), "sb-empty-"))), dir).includes("empty"));
  });
});
