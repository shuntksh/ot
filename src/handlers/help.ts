/**
 * Help handler - displays CLI usage information.
 */

import type { ColorFn, Config } from "../mod";

export function handleHelp(config: Config | null, c: ColorFn): void {
	const jobs = config ? Object.keys(config.workflows) : [];

	console.log(`
${c("bold", "Job Runner")} - Generic workflow runner with Git worktree support

${c("dim", "USAGE:")}
  bun run .config/scripts/runner.ts [job] [options]

${c("dim", "OPTIONS:")}
  ${c("green", "-j, --job <name>")}   Job/workflow to run (optional if positional)
  ${c("green", "-c, --config <path>")} Path to config file
  ${c("green", "-v, --verbose")}      Show output for all steps
  ${c("green", "--changed-files")}    Consume remaining args as changed files
  ${c("green", "--changed-file <path>")} Add one changed file (repeatable)
  ${c("green", "--fail-fast")}        Stop on first failure (default: true)
  ${c("green", "--graph")}            Show dependency graph and exit
  ${c("green", "--no-color")}         Disable colored output
  ${c("green", "--version")}          Show version and exit
  ${c("green", "-h, --help")}         Show this help message

${c("dim", "AVAILABLE JOBS:")}
${jobs.length > 0 ? jobs.map((j) => `  ${c("cyan", j)}`).join("\n") : "  (no config loaded)"}

${c("dim", "CONFIG DISCOVERY:")}
  1. --config <path> (explicit)
  2. Search from CWD up to git root:
     a. workflow.json or .jsonc
     b. workflows.json or .jsonc
     c. package.json → "workflows" field
  3. At git root:
     a. .config/workflow.json or .jsonc
     b. .config/workflows.json or .jsonc

${c("dim", "LEFTHOOK / CHANGED FILES:")}
  ot pre-commit --changed-files {staged_files}
  ot pre-push --changed-files {push_files}

  --changed-files consumes all remaining args. Use changedFiles: "append"
  to pass them as argv, or read OT_CHANGED_FILES, OT_CHANGED_FILES_JSON,
  and OT_CHANGED_FILES_COUNT from child commands.

  Workspace bun steps scope changed files per package and pass package-relative
  paths to each script.

${c("dim", "BUN CACHE:")}
  Enable with bun.cache: true or bun.cache: { inputs, globalInputs }.
  Cache entries are local, per package task, and success-only. Failed,
  timed-out, or killed scripts are never cached.

  Cache keys include package inputs, root/global inputs, the package script
  command, Bun version, action settings, and changed-file argv when appended.

${c("dim", "NESTED STEPS:")}
  Use steps: [...] on a parent step to group related substeps.
  Nested output is displayed under the parent step.

  By default, ready substeps run in parallel. Set parallel: false to run one
  ready substep at a time using the order from steps, while still honoring
  dependsOn. pararell is accepted as a compatibility alias.
  Outside the parent, address nested steps as parent.child.

${c("dim", "BRANCH FILTERING:")}
  branches: ["main"]         Only run on main
  branches: ["!main"]        Run on all except main
  branches: ["feature-*"]    Glob matching
  branches: ["worktree:*"]   Only in git worktrees
`);
}
