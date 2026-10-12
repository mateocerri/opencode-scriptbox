# Proposal: a script registry for agent-created utilities

Companion to the patchflow proposal. Patchflow covers the *write*
path (auditable edits instead of opaque heredocs). This covers the
*compute* path: reusable read-only helpers agents rewrite every
session because nothing persists them.

## Problem

Program-aided agent behavior (PAL/ReAct evidence) favors single
programmatic calls. For pure computation that is correct — but each
session re-derives helpers from scratch (`/tmp` modules, inline
fallbacks), drifting, untested, and burning tokens.

## Proposal stages (upstream)

1. **Convention first.** Document the header contract (descriptive
   name + `purpose:` one-liner) as the recommended shape for
   agent-created utilities.
2. **Discovery primitive.** A catalog surface (tools like
   list/show here) so agents consult before reinventing. Compact
   by design: name + one line, full text on demand.
3. **Usage telemetry.** Last-used tracking to prune dead helpers —
   registries rot without it.

## Non-goals

- No execution runner: shell already runs scripts with full
  auditability. A runner adds surface without value.
- No directory sniffing: closed-world scanning only. Privacy
  requires that unindexed files never enter context.
- No per-script output-dir env vars: placement is decided at
  invocation (`--out` flags), not by registry policy.

## Alternatives considered

- **Skill with pointers:** weak steering; skills load on demand
  while the need fires mid-task.
- **AGENTS.md pointer:** one line pointing at the registry
  complements this, but docs cannot test, version, or track
  usage of the scripts themselves.
- **Committing helpers per repo:** right when the helper is
  project-specific; this registry is for personal cross-repo
  utilities.

## Evidence

Working prototype: this plugin (`scriptbox/save|list|show`),
published on npm, loaded in live sessions. Unit tests cover the
header contract and closed-world indexing.
