# OpenTurbo Context

## Project Overview

**OpenTurbo** is a high-performance, TurboRepo-style task runner designed specifically for the Bun runtime. It emphasizes zero-dependency architecture (apart from Bun itself) and first-class support for Git worktrees.

**Key Features:**
*   **Task Running:** Defines workflows with dependent steps (DAG).
*   **Worktree Awareness:** specialized commands to manage and sync files across Git worktrees.
*   **Workspace Support:** Runs scripts across NPM/Bun workspaces with topological dependency ordering.
*   **Branch Filtering:** Conditionally executes steps based on current branch or worktree context.

## Technology Stack

*   **Runtime:** [Bun](https://bun.sh)
*   **Language:** TypeScript
*   **Validation:** [Zod](https://zod.dev)
*   **Linting/Formatting:** [Biome](https://biomejs.dev)
*   **Documentation Site:** [Astro](https://astro.build) with [Starlight](https://starlight.astro.build)

## Key Commands

Run these commands from the project root:

| Command | Description |
| :--- | :--- |
| `bun install` | Install dependencies. |
| `bun run build` | Compiles the CLI for all supported targets (Darwin/Linux x64/ARM64) to `dist/`. |
| `bun test` | Runs the test suite using Bun's built-in test runner. |
| `bun run lint` | Lints the codebase using Biome. |
| `bun run format` | Formats the codebase using Biome. |
| `bun run all` | Runs the full CI workflow (lint -> format -> build -> test) defined in `workflows.json`. |

### Website Development

The documentation site is located in the `website/` directory.

```bash
cd website
bun install
bun run dev  # Starts the dev server at http://localhost:4321
```

## Codebase Structure

*   `src/` - Core source code.
    *   `cmd.ts` - Main CLI entry point.
    *   `mod.ts` - Shared exports.
    *   `schema.ts` - Zod schemas for configuration validation.
    *   `handlers/` - Command handlers (`run`, `help`, `graph`, `wt`).
    *   `git/` - Git interaction logic.
*   `website/` - Astro/Starlight documentation site.
*   `examples/` - Example projects (e.g., `complex-monorepo`) demonstrating usage.
*   `workflows.json` - The project's own workflow configuration (dogfooding OpenTurbo).
*   `build.ts` - Custom build script using `Bun.build`.

## Configuration

OpenTurbo looks for configuration in:
1.  `workflows.json` / `workflows.jsonc`
2.  `package.json` (`workflows` key)
3.  `.config/workflow.json`

Refer to `src/schema.ts` for the definitive configuration schema.
