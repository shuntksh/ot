/**
 * Run handler - executes workflow steps with dependency resolution.
 */

import type { ColorFn, RunContext, Step, StepResult, StepState } from "../mod";

import {
	createProgressPrinter,
	formatDuration,
	GitUtil,
	getSteps,
	loadConfig,
	normalizeChangedFiles,
	resolveStepsWithDeps,
	runBunAction,
	runCmdAction,
	runWorktreeCpAction,
	shouldRunOnBranch,
} from "../mod";

async function runStep(step: Step, ctx: RunContext): Promise<StepResult> {
	const resultName = step.displayName ?? step.name;
	const stepChangedFilesMode = step.changedFiles ?? "ignore";

	if (step.cmd) {
		const result = await runCmdAction(step.cmd, {
			appendChangedFiles: stepChangedFilesMode === "append",
			changedFiles: ctx.changedFiles,
			changedFilesSpecified: ctx.changedFilesSpecified,
			verbose: ctx.verbose,
		});
		return { ...result, name: resultName };
	}

	if (step["worktree:cp"]) {
		const result = await runWorktreeCpAction(step["worktree:cp"], {
			gitRoot: ctx.gitRoot,
			getWorktrees: GitUtil.getWorktrees,
			verbose: ctx.verbose,
		});
		return { ...result, name: resultName };
	}

	if (step.bun) {
		const bunChangedFilesMode = step.bun.changedFiles ?? stepChangedFilesMode;
		const result = await runBunAction(step.bun, {
			appendChangedFiles: bunChangedFilesMode === "append",
			changedFiles: ctx.changedFiles,
			changedFilesSpecified: ctx.changedFilesSpecified,
			gitRoot: ctx.gitRoot,
			verbose: ctx.verbose,
			stepName: step.name,
			printer: ctx.printer,
		});
		return { ...result, name: resultName };
	}

	return {
		success: false,
		output: `Step "${resultName}" has no action defined`,
		duration: 0,
		name: resultName,
	};
}

export function cleanOutput(output: string): string {
	const lines = output.split("\n").filter((line) => {
		const trimmed = line.trim();
		return !trimmed.startsWith("(pass)") && !trimmed.startsWith("✓");
	});

	const HEAD_LINES = 5;
	const TAIL_LINES = 20;
	const MAX_LINES = HEAD_LINES + TAIL_LINES;

	if (lines.length <= MAX_LINES) {
		return lines.join("\n");
	}

	const head = lines.slice(0, HEAD_LINES);
	const tail = lines.slice(-TAIL_LINES);
	return [
		...head,
		`... (${lines.length - head.length - tail.length} lines hidden) ...`,
		...tail,
	].join("\n");
}

function printFailureDetails(result: StepResult, c: ColorFn): void {
	console.log();
	console.log(c("red", `${"─".repeat(60)}`));
	console.log(c("red", `  FAILED: ${result.name}`));
	console.log(c("red", `${"─".repeat(60)}`));
	console.log();
	console.log(cleanOutput(result.output));
}

function printSummary(
	states: readonly StepState[],
	totalDuration: number,
	c: ColorFn,
): void {
	const passed = states.filter((s) => s.status === "done").length;
	const failed = states.filter((s) => s.status === "failed").length;
	const skipped = states.filter(
		(s) => s.status === "skipped" || s.status === "pending",
	).length;

	console.log();

	if (failed === 0 && skipped === 0) {
		console.log(
			c("green", `✨ All ${passed} steps passed!`) +
				c("dim", ` (${formatDuration(totalDuration)})`),
		);
	} else {
		const parts: string[] = [];
		if (passed > 0) parts.push(c("green", `${passed} passed`));
		if (failed > 0) parts.push(c("red", `${failed} failed`));
		if (skipped > 0) parts.push(c("yellow", `${skipped} skipped`));
		console.log(
			`  ${parts.join(c("dim", " · "))} ${c("dim", `(${formatDuration(totalDuration)})`)}`,
		);
	}
}

async function runStepsWithDeps(
	steps: readonly Step[],
	ctx: RunContext,
	currentBranch: string,
	inWorktree: boolean,
): Promise<readonly StepState[]> {
	const { printer } = ctx;
	const states = new Map<string, StepState>();
	const stepNames = new Set(steps.map((s) => s.name));

	// Initialize all states
	for (const step of steps) {
		const shouldRun = shouldRunOnBranch(
			step.branches,
			currentBranch,
			inWorktree,
		);
		const status = shouldRun ? "pending" : "skipped";
		states.set(step.name, {
			duration: 0,
			output: "",
			status,
			step,
		});
		// Update printer with initial state
		printer?.updateStep(step.name, { status });
	}

	// Initial render
	printer?.initialRender();

	let hasFailed = false;
	const completed = new Set<string>();
	const running = new Map<string, Promise<StepResult>>();

	const _canRun = (step: Step): boolean => {
		for (const dep of step.dependsOn ?? []) {
			if (!stepNames.has(dep)) continue;
			const depState = states.get(dep);
			if (depState?.status !== "done") {
				return false;
			}
		}
		return true;
	};

	const failures: StepResult[] = [];

	while (completed.size < steps.length) {
		for (const step of steps) {
			const state = states.get(step.name);
			if (state?.status !== "pending") continue;
			if (hasFailed && ctx.failFast) {
				state.status = "skipped";
				printer?.updateStep(step.name, { status: "skipped" });
				completed.add(step.name);
				continue;
			}
			const depStates = (step.dependsOn ?? [])
				.map((dep) => states.get(dep))
				.filter((d) => d && stepNames.has(d.step.name));

			// Skip this step if any of its dependencies failed or were skipped.
			if (
				depStates.some((s) => s?.status === "failed" || s?.status === "skipped")
			) {
				state.status = "skipped";
				printer?.updateStep(step.name, { status: "skipped" });
				completed.add(step.name);
				continue;
			}

			// Wait if any dependencies are not yet done.
			if (depStates.some((s) => s?.status !== "done")) {
				continue;
			}

			state.status = "running";
			printer?.updateStep(step.name, { status: "running" });

			const promise = runStep(step, ctx).then((result) => {
				const state = states.get(step.name);
				if (state) {
					state.status = result.success ? "done" : "failed";
					state.duration = result.duration;
					state.output = result.output;
				}
				printer?.updateStep(step.name, {
					status: result.success ? "done" : "failed",
					duration: result.duration,
				});
				if (!result.success) {
					hasFailed = true;
					failures.push(result);
				}
				completed.add(step.name);
				running.delete(step.name);
				return result;
			});

			running.set(step.name, promise);
		}

		if (running.size > 0) {
			await Promise.race(running.values());
		} else if (completed.size < steps.length) {
			break;
		}
	}

	// Cleanup printer
	printer?.cleanup();

	if (!ctx.verbose) {
		for (const failure of failures) {
			printFailureDetails(failure, ctx.c);
		}
	}

	return [...states.values()];
}

export type HandleRunOptions = {
	readonly jobName: string;
	readonly configPath: string | undefined;
	readonly changedFiles: readonly string[];
	readonly changedFilesSpecified: boolean;
	readonly verbose: boolean;
	readonly failFast: boolean;
	readonly isTTY: boolean;
	readonly c: ColorFn;
};

export async function handleRun(options: HandleRunOptions): Promise<number> {
	const {
		jobName,
		configPath,
		changedFiles,
		changedFilesSpecified,
		verbose,
		failFast,
		isTTY,
		c,
	} = options;

	const gitRoot = await GitUtil.getGitRoot();
	const normalizedChangedFiles = normalizeChangedFiles(
		changedFiles,
		process.cwd(),
		gitRoot,
	);
	const config = await loadConfig(configPath, gitRoot);
	const workflow = config.workflows[jobName];

	if (!workflow) {
		const available = Object.keys(config.workflows).join(", ");
		console.error(c("red", `Error: Job "${jobName}" not found`));
		console.error(c("dim", `Available jobs: ${available}`));
		return 1;
	}

	const steps = getSteps(workflow);
	const currentBranch = await GitUtil.getCurrentBranch();
	const inWorktree = await GitUtil.isInWorktree(gitRoot);

	console.log();
	console.log(c("bold", `Running: ${jobName}`));
	console.log(
		c("dim", `Branch: ${currentBranch}${inWorktree ? " (worktree)" : ""}`),
	);
	console.log(c("dim", `Steps: ${steps.length}`));
	if (changedFilesSpecified) {
		console.log(c("dim", `Changed files: ${normalizedChangedFiles.length}`));
	}
	console.log();

	// Create progress printer for centralized TTY display
	const printer = createProgressPrinter(steps, { isTTY, c });

	const ctx: RunContext = {
		c,
		changedFiles: normalizedChangedFiles,
		changedFilesSpecified,
		failFast,
		gitRoot,
		isTTY,
		verbose,
		printer,
	};

	let stepsToRun: Step[];
	try {
		const stepNames = steps.map((s) => s.name);
		stepsToRun = resolveStepsWithDeps(steps, stepNames);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(c("red", `Error: ${message}`));
		return 1;
	}
	const startTime = performance.now();

	const states = await runStepsWithDeps(
		stepsToRun,
		ctx,
		currentBranch,
		inWorktree,
	);

	const totalDuration = Math.round(performance.now() - startTime);
	printSummary(states, totalDuration, c);

	const hasFailures = states.some((s) => s.status === "failed");
	return hasFailures ? 1 : 0;
}
