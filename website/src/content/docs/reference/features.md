---
title: Features
description: Key features of Ot
---

- **Worktree Management**: Full lifecycle management (add, remove, list) with support for post-creation hooks
- **Branch-filtered steps**: Run steps conditionally based on branch patterns with glob and negation support
- **Git worktree support**: Copy files between worktrees, branch-specific filtering for worktree contexts
- **Workspace-aware execution**: Parallel NPM script execution across npm/bun workspaces with dependency ordering
- **Nested step groups**: Group related substeps and display nested progress under the parent step
- **Dependency graph**: Define top-level and nested step dependencies with `dependsOn` for sequential or parallel execution
