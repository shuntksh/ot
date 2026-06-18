import { z } from "zod";

// Shared type definitions converted to Zod schemas

/**
 * Worktree copy action configuration.
 */
export const WorktreeCpActionSchema = z.object({
	from: z.string(),
	files: z.array(z.string()),
	allowMissing: z.boolean().optional(),
});

/**
 * Controls how CLI-provided changed files are passed to a step.
 *
 * - ignore: expose changed files through OT_CHANGED_FILES* env vars only.
 * - append: append changed files as argv after the step command/script.
 */
export const ChangedFilesModeSchema = z.enum(["ignore", "append"]);

/**
 * Local content-hash cache for workspace script invocations.
 */
export const BunCacheSchema = z.union([
	z.boolean(),
	z.object({
		/** Enable or disable cache for this action (default: true for object form). */
		enabled: z.boolean().optional(),
		/** Package-relative git-tracked/untracked input globs. Defaults to all package files. */
		inputs: z.array(z.string()).optional(),
		/** Git-root-relative input globs shared by all packages. */
		globalInputs: z.array(z.string()).optional(),
	}),
]);

/**
 * Bun action configuration for workspace-aware script execution.
 */
export const BunActionSchema = z.object({
	/** Script name to run (matches package.json scripts) */
	script: z.string(),
	/** How to pass CLI-provided changed files to package scripts. */
	changedFiles: ChangedFilesModeSchema.optional(),
	/** Content-hash success cache for package script invocations. */
	cache: BunCacheSchema.optional(),
	/** Hard timeout in seconds. Timed out scripts are killed (default: no timeout). */
	hardTimeoutSeconds: z.number().positive().optional(),
	/** @deprecated Use hardTimeoutSeconds. Timeout in milliseconds. */
	timeout: z.number().optional(),
	/** Turborepo-style dependencies: ^task, task, package#task */
	dependsOn: z.array(z.string()).optional(),
});

const StepBaseSchema = z.object({
	name: z.string(),
	displayName: z.string().optional(),
	description: z.string().optional(),
	dependsOn: z.array(z.string()).optional(),
	branches: z.array(z.string()).optional(),
	/** How to pass CLI-provided changed files to this step. */
	changedFiles: ChangedFilesModeSchema.optional(),
	/** Run nested substeps concurrently when possible. */
	parallel: z.boolean().optional(),
	/** @deprecated Use parallel. Kept for compatibility with existing configs. */
	pararell: z.boolean().optional(),
	cmd: z.string().optional(),
	"worktree:cp": WorktreeCpActionSchema.optional(),
	bun: BunActionSchema.optional(),
});

export type Step = z.infer<typeof StepBaseSchema> & {
	readonly steps?: readonly Step[];
};

/**
 * A single step in a workflow.
 */
export const StepSchema: z.ZodType<Step> = z.lazy(() =>
	StepBaseSchema.extend({
		steps: z.array(StepSchema).optional(),
	}),
);

/**
 * A workflow can be an array of steps or an object with a steps property.
 */
export const WorkflowSchema = z.union([
	z.array(StepSchema),
	z.object({ steps: z.array(StepSchema) }),
]);

/**
 * Worktree hook configuration.
 */
export const WorktreeHookSchema = z.union([
	z.object({
		type: z.literal("copy"),
		from: z.string(),
		to: z.string(),
	}),
	z.object({
		cmd: z.string(),
	}),
]);

/**
 * Worktree management configuration.
 */
export const WorktreeConfigSchema = z.object({
	defaults: z
		.object({
			/** Base directory for worktrees (relative to git root), default: ../worktrees */
			base_dir: z.string().optional(),
		})
		.optional(),
	hooks: z
		.object({
			post_create: z.array(WorktreeHookSchema).optional(),
		})
		.optional(),
});

/**
 * Runner configuration containing workflow definitions.
 */
export const ConfigSchema = z.object({
	workflows: z.record(z.string(), WorkflowSchema),
	worktree: WorktreeConfigSchema.optional(),
});

// Export inferred types
export type WorktreeCpAction = z.infer<typeof WorktreeCpActionSchema>;
export type ChangedFilesMode = z.infer<typeof ChangedFilesModeSchema>;
export type BunCache = z.infer<typeof BunCacheSchema>;
export type BunAction = z.infer<typeof BunActionSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorktreeHook = z.infer<typeof WorktreeHookSchema>;
export type WorktreeConfig = z.infer<typeof WorktreeConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
