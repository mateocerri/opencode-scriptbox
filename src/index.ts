/**
 * opencode-scriptbox — save once, reuse by name.
 *
 * Agents store the utility scripts they need in one canonical user-level
 * directory via `save` (validated on write). `list`/`show` expose them
 * from a live disk scan — no index to drift, no register step. Scripts
 * run via shell; this plugin exposes, never executes.
 */
import { Plugin } from "@opencode/plugin";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  formatCatalog,
  lastUsed,
  matchInvocation,
  recordUse,
  saveScript,
  scan,
} from "./registry.ts";

interface ScriptboxOptions {
  /** Registry directory. Defaults to ~/.config/opencode/scripts. */
  dir?: string;
}

function resolveDir(opts: ScriptboxOptions): string {
  return opts.dir ?? join(homedir(), ".config", "opencode", "scripts");
}

export default Plugin.define({
  id: "scriptbox",
  async setup(ctx) {
    const opts = (ctx.options ?? {}) as ScriptboxOptions;
    const dir = resolveDir(opts);

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "scriptbox",
        description: "Save reusable scripts once, reuse them by name.",
      });
      editor.add({
        name: "save",
        description:
          "Save an agent script (name + content) to the registry. Validates header now; reuse by name after.",
        input: {
          type: "object",
          properties: {
            filename: { type: "string" },
            content: { type: "string" },
          },
          required: ["filename", "content"],
          additionalProperties: false,
        },
        options: { namespace: "scriptbox", codemode: true },
        execute: async (input) => {
          const { filename, content } = input as { filename: string; content: string };
          const result = saveScript(dir, filename, content);
          if ("error" in result) return { content: `scriptbox: ${result.error}` };
          return { content: `scriptbox: '${result.name}' saved — ${result.purpose}` };
        },
      });
      editor.add({
        name: "list",
        description:
          "List saved agent scripts (name + purpose). Check here before ad-hoc heredocs.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "scriptbox", codemode: true },
        execute: async () => {
          mkdirSync(dir, { recursive: true });
          return { content: formatCatalog(scan(dir), dir) };
        },
      });
      editor.add({
        name: "show",
        description: "Show usage and path of one saved script.",
        input: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        },
        options: { namespace: "scriptbox", codemode: true },
        execute: async (input) => {
          const { name } = input as { name: string };
          const entry = scan(dir).scripts[name];
          if (!entry) return { content: `scriptbox: unknown script '${name}' — see list.` };
          const lines = [`${name} — ${entry.description}`, `path: ${entry.path}`];
          if (entry.usage) lines.push(`run: ${entry.usage}`);
          const used = lastUsed(dir, name);
          if (used) lines.push(`last used: ${used}`);
          return { content: lines.join("\n") };
        },
      });
    });

    await ctx.tool.hook("execute.before", async (event) => {
      try {
        if (event.tool !== "shell" && event.tool !== "bash") return;
        const args = event.input as { command?: unknown };
        if (typeof args?.command !== "string") return;
        const names = Object.keys(scan(dir).scripts);
        const name = matchInvocation(args.command, dir, names);
        if (name) recordUse(dir, name);
      } catch {
        // usage tracking never breaks the tool call
      }
    });
  },
});
