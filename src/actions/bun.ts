/**
 * Bun workspace action for turborepo-style parallel script execution.
 */

import {
	buildDependencyGraph,
	discoverWorkspaces,
	resolveTaskDependencies,
	type TaskNode,
	topologicalSort,
} from "../npm-workspace";
import type { NestedTask, ProgressPrinter } from "../progress-printer";
import type { BunAction } from "../types";
import { type ActionResult, withTiming } from "./types";

/**
 * Options for running a bun action.
 */
export type BunActionOptions = {
	readonly verbose: boolean;
	readonly gitRoot: string;
	/** Step name (for printer updates) */
	readonly stepName?: string;
	/** Optional progress printer for nested task display */
	readonly printer?: ProgressPrinter;
};

/**
 * Result for a single task execution including package context.
 */
export type TaskResult = ActionResult & {
	readonly packageName: string;
	readonly script: string;
};

/**
 * Returns the hard timeout in milliseconds for a Bun action.
 */
function getHardTimeoutMs(action: BunAction): number | undefined {
	if (action.hardTimeoutSeconds !== undefined) {
		return Math.round(action.hardTimeoutSeconds * 1000);
	}
	return action.timeout;
}

function killProcessTree(proc: Bun.Subprocess<"ignore", "pipe", "pipe">): void {
	if (process.platform !== "win32") {
		try {
			process.kill(-proc.pid, "SIGKILL");
			return;
		} catch {
			// Fall back to killing the direct child if process-group kill is unavailable.
		}
	}

	try {
		proc.kill("SIGKILL");
	} catch {
		// The process may already have exited between timeout and kill.
	}
}

function normalizeOutput(
	stdout: string,
	stderr: string,
	verbose: boolean,
): string {
	let output = stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");

	if (!verbose) {
		output = output
			.split("\n")
			.filter((line) => !line.trim().startsWith("(pass)"))
			.join("\n");
	}

	return output;
}

/**
 * Runs a single script in a package with an optional hard timeout.
 */
async function runPackageScript(
	node: TaskNode,
	hardTimeoutMs: number | undefined,
	verbose: boolean,
): Promise<TaskResult> {
	const start = performance.now();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;

	try {
		const proc = Bun.spawn(["bun", "run", node.script], {
			cwd: node.packagePath,
			detached: process.platform !== "win32",
			stderr: "pipe",
			stdin: "ignore",
			stdout: "pipe",
		});
		const stdoutPromise = new Response(proc.stdout).text();
		const stderrPromise = new Response(proc.stderr).text();

		if (hardTimeoutMs !== undefined && hardTimeoutMs > 0) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				killProcessTree(proc);
			}, hardTimeoutMs);
			timeoutId.unref?.();
		}

		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			stdoutPromise,
			stderrPromise,
		]);
		const duration = Math.round(performance.now() - start);
		let output = normalizeOutput(stdout, stderr, verbose);

		if (verbose && output.trim()) {
			console.log(`[${node.packageName}] ${output}`);
		}

		if (timedOut) {
			const seconds = ((hardTimeoutMs ?? 0) / 1000).toFixed(2);
			const timeoutMessage = `Hard timeout after ${seconds}s; killed ${node.packageName}#${node.script}`;
			output = output ? `${output}\n${timeoutMessage}` : timeoutMessage;
		}

		return {
			success: !timedOut && exitCode === 0,
			output,
			duration,
			packageName: node.packageName,
			script: node.script,
		};
	} catch (e) {
		const duration = Math.round(performance.now() - start);
		const message = e instanceof Error ? e.message : String(e);

		return {
			success: false,
			output: message,
			duration,
			packageName: node.packageName,
			script: node.script,
		};
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}

/**
 * Runs bun scripts across workspace with dependency ordering.
 *
 * @param action - The bun action configuration
 * @param options - Execution options
 * @returns Aggregated action result
 */
export async function runBunAction(
	action: BunAction,
	options: BunActionOptions,
): Promise<ActionResult> {
	return withTiming(async () => {
		const { printer, stepName } = options;
		const logs: string[] = [];

		// Discover workspace packages
		const packages = await discoverWorkspaces(options.gitRoot);

		if (packages.length === 0) {
			return {
				success: true,
				output: "No workspace packages found",
			};
		}

		// Filter to packages that have the script
		const packagesWithScript = packages.filter(
			(p) => action.script in p.scripts,
		);

		if (packagesWithScript.length === 0) {
			return {
				success: true,
				output: `No packages have script "${action.script}"`,
			};
		}

		// Build dependency graph
		const dependencyGraph = buildDependencyGraph(packages);

		// Resolve task dependencies
		const allNodes = resolveTaskDependencies(
			action.script,
			action.dependsOn ?? [],
			packages,
			dependencyGraph,
		);

		// Topologically sort for execution order
		const layers = topologicalSort(allNodes);

		// Set up nested tasks in printer if available
		if (printer && stepName) {
			const nestedTasks: NestedTask[] = allNodes.map((node) => ({
				id: `${node.packageName}#${node.script}`,
				status: "pending" as const,
			}));
			printer.setNested(stepName, nestedTasks);
		}

		let totalSuccess = true;
		const results: TaskResult[] = [];

		// Execute layer by layer (parallel within each layer)
		for (const layer of layers) {
			if (!layer || layer.length === 0) continue;

			// Mark as running in printer
			if (printer && stepName) {
				for (const node of layer) {
					printer.updateNested(stepName, `${node.packageName}#${node.script}`, {
						status: "running",
					});
				}
			}

			// Run all tasks in this layer in parallel
			const layerPromises = layer.map(async (node) => {
				const result = await runPackageScript(
					node,
					getHardTimeoutMs(action),
					options.verbose,
				);

				// Update printer with result
				if (printer && stepName) {
					printer.updateNested(stepName, `${node.packageName}#${node.script}`, {
						status: result.success ? "done" : "failed",
						duration: result.duration,
					});
				}

				return result;
			});

			const layerResults = await Promise.all(layerPromises);

			for (const result of layerResults) {
				results.push(result);

				const status = result.success ? "✓" : "✗";
				const duration = `${result.duration}ms`;
				logs.push(
					`  ${status} ${result.packageName}#${result.script} (${duration})`,
				);

				if (!result.success) {
					totalSuccess = false;
					// Don't append partial error here, we'll show full logs at the end
				}
			}

			// If any task in this layer failed, skip remaining layers
			if (!totalSuccess) {
				break;
			}
		}

		const passed = results.filter((r) => r.success).length;
		const failed = results.filter((r) => !r.success).length;

		let output = totalSuccess
			? `${passed} packages passed`
			: `${logs.join("\n")}\n\nCompleted: ${passed} passed, ${failed} failed`;

		if (!totalSuccess) {
			const failedResults = results.filter((r) => !r.success);
			output += "\n\nErrors:";
			for (const result of failedResults) {
				output += `\n\n--- ${result.packageName}#${result.script} ---\n`;
				output += result.output;
			}
		}

		return {
			success: totalSuccess,
			output,
		};
	});
}
