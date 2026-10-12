/**
 * opencode-scriptbox — save once, reuse by name.
 *
 * Agents store utility scripts via `save` (validated on write) in the
 * user registry, or with scope "project" in the workdir overlay.
 * `list`/`show` expose them from a live disk scan — no index to drift,
 * no register step. Scripts run via shell; this plugin exposes, never
 * executes.
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
  scanRoots,
  type Root,
} from "./registry.ts";

interface ScriptboxOptions {
  /** Registry directory. Defaults to ~/.config/opencode/scripts. */
  dir?: string;
  /** Also scan <workdir>/scripts (bare). Default false — see registry.ts. */
  scanWorkdirScripts?: boolean;
}

function resolveRoots(opts: ScriptboxOptions): { userDir: string; roots: Root[] } {
  const userDir = opts.dir ?? join(homedir(), ".config", "opencode", "scripts");
  const cwd = process.cwd();
  const roots: Root[] = [{ dir: userDir, origin: "user" }];
  roots.push({ dir: join(cwd, ".opencode", "scripts"), origin: "project" });
  if (opts.scanWorkdirScripts) {
    roots.push({ dir: join(cwd, "scripts"), origin: "project" });
  }
  return { userDir, roots };
}

export default Plugin.define({
  id: "scriptbox",
  async setup(ctx) {
    const opts = (ctx.options ?? {}) as ScriptboxOptions;
    const { userDir, roots } = resolveRoots(opts);

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "scriptbox",
        description: "Save reusable scripts once, reuse them by name.",
      });
      editor.add({
        name: "save",
        description:
          "Save an agent script (filename + content) to the registry. Scope user or project; validates header now.",
        input: {
          type: "object",
          properties: {
            filename: { type: "string" },
            content: { type: "string" },
            scope: { type: "string", enum: ["user", "project"] },
          },
          required: ["filename", "content"],
          additionalProperties: false,
        },
        options: { namespace: "scriptbox", codemode: true },
        execute: async (input) => {
          const { filename, content, scope } = input as {
            filename: string;
            content: string;
            scope?: "user" | "project";
          };
          const target =
            scope === "project" ? roots.find((r) => r.origin === "project")!.dir : userDir;
          const result = saveScript(target, filename, content);
          if ("error" in result) return { content: `scriptbox: ${result.error}` };
          const where = scope === "project" ? "project overlay" : "user registry";
          return { content: `scriptbox: '${result.name}' saved to ${where} — ${result.purpose}` };
        },
      });
      editor.add({
        name: "list",
        description:
          "List saved agent scripts (name + purpose, origin-marked). Check here before ad-hoc heredocs.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "scriptbox", codemode: true },
        execute: async () => {
          mkdirSync(userDir, { recursive: true });
          return { content: formatCatalog(scanRoots(roots), userDir) };
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
          const entry = scanRoots(roots).scripts[name];
          if (!entry) return { content: `scriptbox: unknown script '${name}' — see list.` };
          const lines = [
            `${name} — ${entry.description}`,
            `origin: ${entry.origin}`,
            `path: ${entry.path}`,
          ];
          if (entry.usage) lines.push(`run: ${entry.usage}`);
          const used = lastUsed(userDir, entry, name);
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
        const catalog = scanRoots(roots);
        const hit = matchInvocation(args.command, catalog);
        if (hit) recordUse(userDir, hit.entry, hit.name);
      } catch {
        // usage tracking never breaks the tool call
      }
    });
  },
});
