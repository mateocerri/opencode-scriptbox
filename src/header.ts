/**
 * Header contract for registered scripts.
 *
 * A script is visible to agents only when its file name is descriptive
 * and its leading header block carries a `purpose:` one-liner. Anything
 * else stays on disk, unindexed and invisible (closed world).
 */

export interface ScriptHeader {
  purpose: string;
  usage: string | null;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*\.(py|sh)$/;
const MAX_NAME = 64;
const MAX_PURPOSE = 140;

export function validateFileName(base: string): string | null {
  if (base.length > MAX_NAME) return `file name exceeds ${MAX_NAME} chars`;
  if (!NAME_RE.test(base)) {
    return "file name must be lowercase alphanumeric/hyphens with .py or .sh extension";
  }
  const first = base.split("-")[0].split(".")[0];
  if (first === "tmp" || first === "test") {
    return "file name must be descriptive, not tmp-*/test-*";
  }
  return null;
}

function headerBlock(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let i = 0;
  if (lines[0]?.startsWith("#!")) i = 1;
  // Python module docstring as header.
  if (lines[i]?.trimStart().startsWith('"""')) {
    const start = i;
    out.push(lines[i].replace(/^\s*"""/, ""));
    if (!lines[i].includes('"""', 3)) {
      i++;
      while (i < lines.length && !lines[i].includes('"""')) {
        out.push(lines[i]);
        i++;
      }
      if (i < lines.length) out.push(lines[i].split('"""')[0]);
    } else {
      out[0] = out[0].split('"""')[0];
    }
    void start;
    return out.join("\n");
  }
  // Leading `#` comment block.
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === "") {
      i++;
      continue;
    }
    if (!t.startsWith("#")) break;
    out.push(t.replace(/^#\s?/, ""));
    i++;
  }
  return out.join("\n");
}

function field(block: string, name: string): string | null {
  const m = block.match(new RegExp(`^\\s*${name}\\s*:(.*)$`, "im"));
  const v = m?.[1]?.trim() ?? "";
  return v === "" ? null : v;
}

export function parseHeader(source: string): { header: ScriptHeader } | { error: string } {
  const block = headerBlock(source);
  const purpose = field(block, "purpose");
  if (!purpose) return { error: "header must contain a `purpose:` one-liner" };
  if (purpose.length > MAX_PURPOSE) {
    return { error: `purpose exceeds ${MAX_PURPOSE} chars` };
  }
  return { header: { purpose, usage: field(block, "usage") } };
}
