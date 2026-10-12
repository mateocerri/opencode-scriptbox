import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHeader, validateFileName } from "../src/header.ts";

describe("validateFileName", () => {
  it("accepts descriptive names", () => {
    assert.equal(validateFileName("png-compare.py"), null);
    assert.equal(validateFileName("bbox-diff.sh"), null);
    assert.equal(validateFileName("a1.py"), null);
  });
  it("rejects tmp/test prefixes, case, extensions", () => {
    assert.notEqual(validateFileName("tmp-1.py"), null);
    assert.notEqual(validateFileName("test-x.sh"), null);
    assert.notEqual(validateFileName("Tmp.py"), null);
    assert.notEqual(validateFileName("noext"), null);
    assert.notEqual(validateFileName("weird_name.py"), null);
    assert.notEqual(validateFileName("x".repeat(65) + ".py"), null);
  });
});

describe("parseHeader", () => {
  it("reads python docstring headers", () => {
    const src = `"""purpose: Compare screenshots.\nusage: python3 png-compare.py A B\n"""\nimport sys\n`;
    const r = parseHeader(src);
    assert.ok("header" in r);
    if ("header" in r) {
      assert.equal(r.header.purpose, "Compare screenshots.");
      assert.equal(r.header.usage, "python3 png-compare.py A B");
    }
  });
  it("reads single-line docstrings and shell comments", () => {
    const py = `"""purpose: One liner."""\nx = 1\n`;
    assert.ok("header" in parseHeader(py));
    const sh = `#!/bin/sh\n# purpose: Clean caches.\n# usage: sh clean.sh\nrm -rf x\n`;
    const r = parseHeader(sh);
    assert.ok("header" in r);
    if ("header" in r) assert.equal(r.header.purpose, "Clean caches.");
  });
  it("rejects missing or overlong purpose", () => {
    assert.ok("error" in parseHeader(`x = 1\n`));
    assert.ok("error" in parseHeader(`# usage: something\n`));
    assert.ok("error" in parseHeader(`"""purpose: ${"y".repeat(141)}"""\n`));
  });
});
