/**
 * opencode-scriptbox — closed-world registry of reusable agent scripts.
 *
 * Agents create the utility scripts they need in one canonical user-level
 * directory. Only files with a descriptive name and a `purpose:` header
 * are indexed and exposed; everything else on disk stays invisible.
 * Scripts run via shell — this plugin exposes, never executes.
 */
import { Plugin } from "@opencode/plugin";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { mkdirSync } from "node:fs";
import { parseHeader, validateFileName } from "./header.ts";
import {
  buildIndex,
  formatCatalog,
  loadIndex,
  matchInvocation,
  saveIndex,
  touchUsed,
} from "./registry.ts";

interface ScriptboxOptions {
  /** Registry directory. Defaults to ~/.config/opencode/scripts. */
  dir?: string;
}

function resolveDir(opts: ScriptboxOptions): string {
  return opts.dir ?? join(homedir(), ".config", "opencode", "scripts");
}

function refresh(dir: string) {
  mkdirSync(dir, { recursive: true });
  const next = buildIndex(dir, loadIndex(dir));
  saveIndex(dir, next);
  return next;
}

export default Plugin.define({
  id: "scriptbox",
  async setup(ctx) {
    const opts = (ctx.options ?? {}) as ScriptboxOptions;
    const dir = resolveDir(opts);

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "scriptbox",
        description: "Reusable agent utility scripts with one-line index.",
      });
      editor.add({
        name: "list",
        description:
          "List registered agent scripts (name + purpose). Check here before ad-hoc heredocs.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "scriptbox", codemode: true },
        execute: async () => ({ content: formatCatalog(refresh(dir)) }),
      });
      editor.add({
        name: "show",
        description: "Show usage and path of one registered script.",
        input: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        },
        options: { namespace: "scriptbox", codemode: true },
        execute: async (input) => {
          const { name } = input as { name: string };
          const entry = refresh(dir).scripts[name];
          if (!entry) return { content: `scriptbox: unknown script '${name}' — see list.` };
          const lines = [`${name} — ${entry.description}`, `path: ${entry.path}`];
          if (entry.usage) lines.push(`usage: ${entry.usage}`);
          if (entry.lastUsed) lines.push(`last used: ${entry.lastUsed}`);
          return { content: lines.join("\n") };
        },
      });
      editor.add({
        name: "register",
        description: "Validate a script file and index it now.",
        input: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
        options: { namespace: "scriptbox", codemode: true },
        execute: async (input) => {
          const { path } = input as { path: string };
          const abs = resolve(path);
          if (abs !== dir && !abs.startsWith(dir + sep)) {
            return { content: `scriptbox: must live in registry dir ${dir}` };
          }
          const { readFileSync } = await import("node:fs");
          const base = abs.split(sep).pop() ?? "";
          const badName = validateFileName(base);
          if (badName) return { content: `scriptbox: ${badName}` };
          let source: string;
          try {
            source = readFileSync(abs, "utf8");
          } catch (err) {
            return { content: `scriptbox: cannot read ${abs}: ${String(err)}` };
          }
          const parsed = parseHeader(source);
          if ("error" in parsed) return { content: `scriptbox: ${parsed.error}` };
          const name = base.replace(/\.(py|sh)$/, "");
          refresh(dir);
          return { content: `scriptbox: '${name}' indexed — ${parsed.header.purpose}` };
        },
      });
    });

    await ctx.tool.hook("execute.before", async (event) => {
      try {
        if (event.tool !== "shell" && event.tool !== "bash") return;
        const args = event.input as { command?: unknown };
        if (typeof args?.command !== "string") return;
        const index = loadIndex(dir);
        if (!index) return;
        const name = matchInvocation(args.command, dir, index);
        if (name) touchUsed(dir, name);
      } catch {
        // usage tracking never breaks the tool call
      }
    });
  },
});
