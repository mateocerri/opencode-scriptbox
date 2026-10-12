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
  scanDir,
  scanRoots,
} from "../src/registry.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scriptbox-reg-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const GOOD_PY = `"""purpose: Compare screenshots.\nusage: python3 png-compare.py A B\n"""\n`;
const NO_HEADER = `import sys\nprint(sys.argv)\n`;

describe("scanDir/scanRoots", () => {
  it("indexes valid scripts, ignores the rest (closed world)", () => {
    writeFileSync(join(dir, "png-compare.py"), GOOD_PY);
    writeFileSync(join(dir, "scratch.py"), NO_HEADER);
    writeFileSync(join(dir, "tmp-1.py"), GOOD_PY);
    writeFileSync(join(dir, "notes.txt"), GOOD_PY);
    const result = scanDir(dir, "user");
    assert.deepEqual(Object.keys(result.scripts), ["png-compare"]);
    assert.equal(result.scripts["png-compare"].description, "Compare screenshots.");
    assert.equal(result.scripts["png-compare"].origin, "user");
    assert.equal(result.ignored, 3);
  });
  it("project root shadows user on collision, origin marked", () => {
    const proj = mkdtempSync(join(tmpdir(), "scriptbox-proj-"));
    try {
      writeFileSync(join(dir, "dup.py"), GOOD_PY);
      writeFileSync(join(proj, "dup.py"), `"""purpose: Project override.\n"""\n`);
      const merged = scanRoots([
        { dir, origin: "user" },
        { dir: proj, origin: "project" },
      ]);
      assert.equal(merged.scripts["dup"].description, "Project override.");
      assert.equal(merged.scripts["dup"].origin, "project");
      const cat = formatCatalog(merged, dir);
      assert.ok(cat.includes("dup [project] — Project override."));
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });
  it("empty or missing dir scans clean", () => {
    assert.deepEqual(Object.keys(scanDir(dir, "user").scripts), []);
    assert.deepEqual(Object.keys(scanDir(join(dir, "nope"), "project").scripts), []);
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
    assert.deepEqual(Object.keys(scanDir(dir, "user").scripts), ["png-compare"]);
  });
});

describe("recordUse + matchInvocation", () => {
  it("stamps usage by absolute path, only for indexed scripts", () => {
    writeFileSync(join(dir, "png-compare.py"), GOOD_PY);
    const catalog = scanRoots([{ dir, origin: "user" }]);
    const hit = matchInvocation(`python3 ${dir}/png-compare.py a b`, catalog);
    assert.equal(hit?.name, "png-compare");
    assert.equal(matchInvocation("python3 /elsewhere/png-compare.py a", catalog), null);
    assert.equal(matchInvocation("ls -la", catalog), null);
    assert.equal(lastUsed(dir, hit!.entry, "png-compare"), null);
    assert.equal(recordUse(dir, hit!.entry, "png-compare"), true);
    assert.ok(lastUsed(dir, hit!.entry, "png-compare"));
  });
});

describe("formatCatalog", () => {
  it("renders one line per script, empty state otherwise", () => {
    writeFileSync(join(dir, "png-compare.py"), GOOD_PY);
    const cat = formatCatalog(scanRoots([{ dir, origin: "user" }]), dir);
    assert.ok(cat.includes("png-compare — Compare screenshots."));
    assert.ok(
      formatCatalog(scanRoots([{ dir: mkdtempSync(join(tmpdir(), "sb-empty-")), origin: "user" }]), dir).includes("empty"),
    );
  });
});
