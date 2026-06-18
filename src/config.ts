/**
 * Configuration parsing utilities.
 */

import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ZodError } from "zod";
import { formatZodError } from "./formatting";
import type { Config, Step, Workflow } from "./types";
import { ConfigSchema } from "./types";

type PathPart = string | number;

const STEP_FIELDS = new Set([
	"name",
	"displayName",
	"description",
	"dependsOn",
	"branches",
	"changedFiles",
	"parallel",
	"pararell",
	"cmd",
	"worktree:cp",
	"bun",
	"steps",
]);

const BUN_FIELDS = new Set([
	"script",
	"changedFiles",
	"cache",
	"hardTimeoutSeconds",
	"timeout",
	"dependsOn",
]);

const WORKTREE_CP_FIELDS = new Set(["from", "files", "allowMissing"]);

function formatPath(parts: readonly PathPart[]): string {
	return parts
		.map((part, index) => {
			if (typeof part === "number") return `[${part}]`;
			return index === 0 ? part : `.${part}`;
		})
		.join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateStringArray(
	value: unknown,
	path: readonly PathPart[],
	issues: string[],
): void {
	if (!Array.isArray(value)) {
		issues.push(`${formatPath(path)} must be an array of strings.`);
		return;
	}

	for (let i = 0; i < value.length; i++) {
		if (typeof value[i] !== "string") {
			issues.push(`${formatPath([...path, i])} must be a string.`);
		}
	}
}

function validateBunAction(
	value: unknown,
	path: readonly PathPart[],
	issues: string[],
): void {
	if (!isRecord(value)) {
		issues.push(`${formatPath(path)} must be an object.`);
		return;
	}

	for (const key of Object.keys(value)) {
		if (!BUN_FIELDS.has(key)) {
			issues.push(
				`${formatPath([...path, key])} is not supported on bun actions.`,
			);
		}
	}

	if (typeof value.script !== "string" || value.script.length === 0) {
		issues.push(
			`${formatPath([...path, "script"])} must be a non-empty string.`,
		);
	}
	if (
		value.changedFiles !== undefined &&
		value.changedFiles !== "ignore" &&
		value.changedFiles !== "append"
	) {
		issues.push(
			`${formatPath([...path, "changedFiles"])} must be "ignore" or "append".`,
		);
	}
	if (value.dependsOn !== undefined) {
		validateStringArray(value.dependsOn, [...path, "dependsOn"], issues);
	}
}

function validateWorktreeCpAction(
	value: unknown,
	path: readonly PathPart[],
	issues: string[],
): void {
	if (!isRecord(value)) {
		issues.push(`${formatPath(path)} must be an object.`);
		return;
	}

	for (const key of Object.keys(value)) {
		if (!WORKTREE_CP_FIELDS.has(key)) {
			issues.push(
				`${formatPath([...path, key])} is not supported on worktree:cp actions.`,
			);
		}
	}

	if (typeof value.from !== "string" || value.from.length === 0) {
		issues.push(`${formatPath([...path, "from"])} must be a non-empty string.`);
	}
	validateStringArray(value.files, [...path, "files"], issues);
}

function validateStep(
	value: unknown,
	path: readonly PathPart[],
	issues: string[],
): void {
	if (!isRecord(value)) {
		issues.push(`${formatPath(path)} must be a step object.`);
		return;
	}

	for (const key of Object.keys(value)) {
		if (STEP_FIELDS.has(key)) continue;
		if (key === "cache") {
			issues.push(
				`${formatPath([...path, key])} is not supported on workflow steps. Move it to bun.cache or remove it from this cmd step.`,
			);
			continue;
		}
		issues.push(`${formatPath([...path, key])} is not a supported step field.`);
	}

	if (typeof value.name !== "string" || value.name.length === 0) {
		issues.push(`${formatPath([...path, "name"])} must be a non-empty string.`);
	}
	if (
		value.displayName !== undefined &&
		typeof value.displayName !== "string"
	) {
		issues.push(`${formatPath([...path, "displayName"])} must be a string.`);
	}
	if (
		value.description !== undefined &&
		typeof value.description !== "string"
	) {
		issues.push(`${formatPath([...path, "description"])} must be a string.`);
	}
	if (value.dependsOn !== undefined) {
		validateStringArray(value.dependsOn, [...path, "dependsOn"], issues);
	}
	if (value.branches !== undefined) {
		validateStringArray(value.branches, [...path, "branches"], issues);
	}
	if (
		value.changedFiles !== undefined &&
		value.changedFiles !== "ignore" &&
		value.changedFiles !== "append"
	) {
		issues.push(
			`${formatPath([...path, "changedFiles"])} must be "ignore" or "append".`,
		);
	}
	if (value.parallel !== undefined && typeof value.parallel !== "boolean") {
		issues.push(`${formatPath([...path, "parallel"])} must be a boolean.`);
	}
	if (value.pararell !== undefined && typeof value.pararell !== "boolean") {
		issues.push(`${formatPath([...path, "pararell"])} must be a boolean.`);
	}
	if (value.cmd !== undefined && typeof value.cmd !== "string") {
		issues.push(`${formatPath([...path, "cmd"])} must be a string.`);
	}
	if (value.bun !== undefined) {
		validateBunAction(value.bun, [...path, "bun"], issues);
	}
	if (value["worktree:cp"] !== undefined) {
		validateWorktreeCpAction(
			value["worktree:cp"],
			[...path, "worktree:cp"],
			issues,
		);
	}
	if (value.steps !== undefined) {
		validateSteps(value.steps, [...path, "steps"], issues);
	}
}

function validateSteps(
	value: unknown,
	path: readonly PathPart[],
	issues: string[],
): void {
	if (!Array.isArray(value)) {
		issues.push(`${formatPath(path)} must be an array of steps.`);
		return;
	}

	for (let i = 0; i < value.length; i++) {
		validateStep(value[i], [...path, i], issues);
	}
}

function validateWorkflow(
	value: unknown,
	path: readonly PathPart[],
	issues: string[],
): void {
	if (Array.isArray(value)) {
		validateSteps(value, path, issues);
		return;
	}

	if (!isRecord(value)) {
		issues.push(
			`${formatPath(path)} must be an array or an object with steps.`,
		);
		return;
	}

	if (!("steps" in value)) {
		issues.push(`${formatPath(path)} must include a steps array.`);
		return;
	}

	validateSteps(value.steps, [...path, "steps"], issues);
}

function validateConfigSemantics(config: unknown, sourceName: string): void {
	const issues: string[] = [];

	if (!isRecord(config)) {
		issues.push("Config must be an object.");
	} else if (!isRecord(config.workflows)) {
		issues.push("workflows must be an object.");
	} else {
		for (const [name, workflow] of Object.entries(config.workflows)) {
			validateWorkflow(workflow, ["workflows", name], issues);
		}
	}

	if (issues.length > 0) {
		throw new Error(
			`Invalid config in ${sourceName}:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
		);
	}
}

function parseConfigObject(config: unknown, sourceName: string): Config {
	validateConfigSemantics(config, sourceName);
	try {
		return ConfigSchema.parse(config);
	} catch (e) {
		if (e instanceof ZodError) {
			throw new Error(formatZodError(e, `Invalid config in ${sourceName}`));
		}
		throw e;
	}
}

/**
 * Loads configuration from potential config files.
 *
 * @param explicitPath - Explicit path to config file provided by user
 * @param gitRoot - Root of the git repository
 * @returns Parsed configuration
 */
export async function loadConfig(
	explicitPath: string | undefined,
	gitRoot: string,
): Promise<Config> {
	const candidates: string[] = [];

	if (explicitPath) {
		candidates.push(explicitPath);
	} else {
		let current = process.cwd();
		while (true) {
			candidates.push(
				join(current, "workflow.json"),
				join(current, "workflow.jsonc"),
				join(current, "workflows.json"),
				join(current, "workflows.jsonc"),
				join(current, "package.json"),
			);

			if (current === gitRoot) {
				// At git root, also check .config subfolder
				candidates.push(
					join(current, ".config", "workflow.json"),
					join(current, ".config", "workflow.jsonc"),
					join(current, ".config", "workflows.json"),
					join(current, ".config", "workflows.jsonc"),
				);
				break;
			}

			const parent = dirname(current);
			if (parent === current) break; // Reached filesystem root
			current = parent;
		}
	}

	for (const path of candidates) {
		if (!existsSync(path)) continue;

		const content = await Bun.file(path).text();
		const isJsonc = path.endsWith(".jsonc");
		const isPackageJson = basename(path) === "package.json";

		let parsed: unknown;
		try {
			parsed = JSON.parse(isJsonc ? stripJsonComments(content) : content);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			throw new Error(`Invalid JSON in ${path}:\n  ${message}`);
		}

		if (isPackageJson) {
			if (isRecord(parsed) && parsed.workflows) {
				// package.json only supports workflows, no top-level worktree config currently
				const config = { workflows: parsed.workflows };
				return parseConfigObject(config, basename(path));
			}
			continue; // Try next candidate if no workflows field
		}

		if (isRecord(parsed) && (parsed.workflows || parsed.worktree)) {
			const config = {
				workflows: parsed.workflows || {},
				worktree: parsed.worktree,
			};
			return parseConfigObject(config, basename(path));
		}

		// Direct workflow definitions (legacy format)
		const config = { workflows: parsed };
		return parseConfigObject(config, basename(path));
	}

	throw new Error(
		`No workflow config found. Checked:\n${candidates.map((c) => `  - ${c}`).join("\n")}`,
	);
}

/**
 * Strips single-line and multi-line comments from JSONC content.
 *
 * @param jsonc - JSONC string with comments
 * @returns JSON string with comments removed
 */
export function stripJsonComments(jsonc: string): string {
	// Remove single-line comments (// ...)
	let result = jsonc.replace(/\/\/.*$/gm, "");
	// Remove multi-line comments (/* ... */)
	result = result.replace(/\/\*[\s\S]*?\*\//g, "");
	return result;
}

/**
 * Extracts steps from a workflow, handling both array and object forms.
 *
 * @param workflow - Workflow definition (array or object with steps)
 * @returns Array of steps
 */
export function getSteps(workflow: Workflow): readonly Step[] {
	if ("steps" in workflow) {
		return workflow.steps;
	}
	return workflow;
}
