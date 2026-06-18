/**
 * Centralized progress printer with virtual DOM-style diffing.
 *
 * Stores previously rendered lines and diffs against new state to
 * efficiently update only what changed.
 */

import { ANSI } from "./colors";
import type { ColorFn, StepStatus } from "./types";

/**
 * Nested task displayed under a step.
 */
export type NestedTask = {
	readonly id: string;
	status: "pending" | "running" | "done" | "failed";
	duration?: number;
	startedAt?: number;
};

/**
 * Step state for rendering.
 */
export type RenderStepState = {
	name: string;
	displayName: string;
	status: StepStatus;
	duration?: number;
	nested: NestedTask[];
	showNested: boolean;
	startedAt?: number;
};

/**
 * Options for creating a progress printer.
 */
export type ProgressPrinterOptions = {
	readonly isTTY: boolean;
	readonly c: ColorFn;
};

/**
 * Formats a step line for display.
 */
function formatElapsed(startedAt: number | undefined, now: number): string {
	if (startedAt === undefined) return "";

	const elapsedSeconds = Math.floor((now - startedAt) / 1000);
	return `(${elapsedSeconds}s elapsed)`;
}

function formatDuration(ms: number | undefined): string {
	if (ms === undefined || ms === 0) return "";
	return ms >= 1000 ? `(${(ms / 1000).toFixed(2)}s)` : `(${ms}ms)`;
}

function formatStepLine(
	state: RenderStepState,
	c: ColorFn,
	now: number,
): string {
	const name = state.displayName.padEnd(16);
	const duration = formatDuration(state.duration);

	switch (state.status) {
		case "pending":
			return `  ${c("dim", "○")} ${c("dim", name)} ${c("dim", "waiting...")}`;
		case "running":
			return `  ${c("cyan", "◐")} ${c("cyan", name)} ${c("dim", `running... ${formatElapsed(state.startedAt, now)}`)}`;
		case "done":
			return `  ${c("green", "✓")} ${name} ${c("dim", duration)}`;
		case "failed":
			return `  ${c("red", "✗")} ${name} ${c("dim", duration)}`;
		case "skipped":
			return `  ${c("yellow", "○")} ${c("yellow", name)} ${c("dim", "skipped")}`;
		default:
			return `  ${c("dim", "○")} ${name}`;
	}
}

/**
 * Formats a nested task line for display.
 */
function formatNestedLine(task: NestedTask, c: ColorFn, now: number): string {
	const duration = formatDuration(task.duration);

	switch (task.status) {
		case "pending":
			return `      ${c("dim", "○")} ${c("dim", task.id)}`;
		case "running":
			return `      ${c("cyan", "◐")} ${c("cyan", task.id)} ${c("dim", formatElapsed(task.startedAt, now))}`;
		case "done":
			return `      ${c("green", "✓")} ${task.id} ${c("dim", duration)}`;
		case "failed":
			return `      ${c("red", "✗")} ${task.id} ${c("dim", duration)}`;
		default:
			return `      ${c("dim", "○")} ${task.id}`;
	}
}

/**
 * Centralized progress printer with VDOM-style diffing.
 *
 * Tracks previously rendered lines and diffs against new state.
 */
export class ProgressPrinter {
	readonly #steps: Map<string, RenderStepState>;
	readonly #stepOrder: readonly string[];
	readonly #isTTY: boolean;
	readonly #c: ColorFn;

	/** Previously rendered lines (the "old VDOM") */
	#renderedLines: string[] = [];
	#isRendered = false;
	#elapsedTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		steps: readonly (
			| string
			| { readonly name: string; readonly displayName?: string }
		)[],
		options: ProgressPrinterOptions,
	) {
		this.#steps = new Map();
		const normalizedSteps = steps.map((step) =>
			typeof step === "string" ? { name: step } : step,
		);
		this.#stepOrder = normalizedSteps.map((step) => step.name);
		this.#isTTY = options.isTTY;
		this.#c = options.c;

		for (const step of normalizedSteps) {
			this.#steps.set(step.name, {
				name: step.name,
				displayName: step.displayName ?? step.name,
				status: "pending",
				nested: [],
				showNested: false,
			});
		}
	}

	/**
	 * Update a step's state and re-render.
	 */
	updateStep(
		name: string,
		update: Partial<Pick<RenderStepState, "status" | "duration">>,
	): void {
		const state = this.#steps.get(name);
		if (!state) return;

		if (update.status !== undefined) state.status = update.status;
		if (update.duration !== undefined) state.duration = update.duration;
		this.#updateStartTime(state, update.status);

		// Hide nested when step completes
		if (state.status === "done" || state.status === "failed") {
			state.showNested = false;
		}

		this.#reconcile();
		this.#syncElapsedTimer();
	}

	/**
	 * Set nested tasks for a step.
	 */
	setNested(stepName: string, tasks: readonly NestedTask[]): void {
		const state = this.#steps.get(stepName);
		if (!state) return;

		const now = performance.now();
		state.nested = tasks.map((task) => ({
			...task,
			startedAt:
				task.status === "running" ? (task.startedAt ?? now) : task.startedAt,
		}));
		state.showNested = true;
		this.#reconcile();
		this.#syncElapsedTimer();
	}

	/**
	 * Update a specific nested task.
	 */
	updateNested(
		stepName: string,
		taskId: string,
		update: Partial<Pick<NestedTask, "status" | "duration">>,
	): void {
		const state = this.#steps.get(stepName);
		if (!state) return;

		const task = state.nested.find((t) => t.id === taskId);
		if (!task) return;

		if (update.status !== undefined) task.status = update.status;
		if (update.duration !== undefined) task.duration = update.duration;
		this.#updateStartTime(task, update.status);

		this.#reconcile();
		this.#syncElapsedTimer();
	}

	/**
	 * Initial render - call once before updates.
	 */
	initialRender(): void {
		if (this.#isRendered) return;

		if (this.#isTTY) {
			process.stdout.write(ANSI.hideCursor);
		}

		const newLines = this.#buildLines();
		for (const line of newLines) {
			console.log(line);
		}
		this.#renderedLines = newLines;
		this.#isRendered = true;
		this.#syncElapsedTimer();
	}

	/**
	 * Build lines array from current state (the "new VDOM").
	 */
	#buildLines(now = performance.now()): string[] {
		const lines: string[] = [];

		for (const name of this.#stepOrder) {
			const state = this.#steps.get(name);
			if (!state) continue;

			lines.push(formatStepLine(state, this.#c, now));

			if (state.showNested) {
				for (const task of state.nested) {
					lines.push(formatNestedLine(task, this.#c, now));
				}
			}
		}

		return lines;
	}

	/**
	 * Reconcile: diff old vs new lines and update terminal.
	 */
	#reconcile(): void {
		if (!this.#isRendered) return;
		if (!this.#isTTY) return;

		const oldLines = this.#renderedLines;
		const newLines = this.#buildLines();
		const maxLen = Math.max(oldLines.length, newLines.length);

		// Move cursor to start of our output area
		if (oldLines.length > 0) {
			process.stdout.write(ANSI.cursorUp(oldLines.length));
		}

		// Write each line, clearing as we go
		for (let i = 0; i < maxLen; i++) {
			process.stdout.write(ANSI.clearLine);
			if (i < newLines.length) {
				process.stdout.write(`${newLines[i]}\n`);
			} else {
				// Line was removed, just move down
				process.stdout.write("\n");
			}
		}

		// If new output is shorter, we've left empty lines - move cursor back up
		if (newLines.length < oldLines.length) {
			process.stdout.write(ANSI.cursorUp(oldLines.length - newLines.length));
		}

		this.#renderedLines = newLines;
	}

	#updateStartTime(
		state: { status: StepStatus | NestedTask["status"]; startedAt?: number },
		status: StepStatus | NestedTask["status"] | undefined,
	): void {
		if (status === "running" && state.startedAt === undefined) {
			state.startedAt = performance.now();
		}
		if (status !== undefined && status !== "running") {
			state.startedAt = undefined;
		}
	}

	#hasRunningTasks(): boolean {
		for (const state of this.#steps.values()) {
			if (state.status === "running") return true;
			if (state.nested.some((task) => task.status === "running")) return true;
		}
		return false;
	}

	#syncElapsedTimer(): void {
		if (!this.#isRendered || !this.#isTTY || !this.#hasRunningTasks()) {
			if (this.#elapsedTimer !== undefined) {
				clearInterval(this.#elapsedTimer);
				this.#elapsedTimer = undefined;
			}
			return;
		}

		if (this.#elapsedTimer !== undefined) return;

		this.#elapsedTimer = setInterval(() => {
			this.#reconcile();
		}, 1000);
		this.#elapsedTimer.unref?.();
	}

	/**
	 * Cleanup - show cursor.
	 */
	cleanup(): void {
		if (this.#elapsedTimer !== undefined) {
			clearInterval(this.#elapsedTimer);
			this.#elapsedTimer = undefined;
		}
		if (this.#isTTY) {
			process.stdout.write(ANSI.showCursor);
		}
	}
}

/**
 * Creates a progress printer for the given steps.
 */
export function createProgressPrinter(
	steps: readonly (
		| string
		| { readonly name: string; readonly displayName?: string }
	)[],
	options: ProgressPrinterOptions,
): ProgressPrinter {
	return new ProgressPrinter(steps, options);
}
