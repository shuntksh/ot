import { describe, expect, test } from "bun:test";
import { prepareWorkflowSteps, resolveStepsWithDeps } from "./graph";
import type { Step } from "./types";

describe("resolveStepsWithDeps", () => {
	test("returns requested step with no dependencies", () => {
		const steps: Step[] = [
			{ name: "lint", cmd: "bun lint" },
			{ name: "test", cmd: "bun test" },
		];

		const result = resolveStepsWithDeps(steps, ["lint"]);
		expect(result.map((s) => s.name)).toEqual(["lint"]);
	});

	test("includes direct dependencies", () => {
		const steps: Step[] = [
			{ name: "lint", cmd: "bun lint" },
			{ name: "build", cmd: "bun build", dependsOn: ["lint"] },
		];

		const result = resolveStepsWithDeps(steps, ["build"]);
		expect(result.map((s) => s.name)).toEqual(["lint", "build"]);
	});

	test("includes transitive dependencies", () => {
		const steps: Step[] = [
			{ name: "lint", cmd: "bun lint" },
			{ name: "build", cmd: "bun build", dependsOn: ["lint"] },
			{ name: "test", cmd: "bun test", dependsOn: ["build"] },
		];

		const result = resolveStepsWithDeps(steps, ["test"]);
		expect(result.map((s) => s.name)).toEqual(["lint", "build", "test"]);
	});

	test("deduplicates shared dependencies", () => {
		const steps: Step[] = [
			{ name: "lint", cmd: "bun lint" },
			{ name: "build", cmd: "bun build", dependsOn: ["lint"] },
			{ name: "test", cmd: "bun test", dependsOn: ["lint"] },
		];

		const result = resolveStepsWithDeps(steps, ["build", "test"]);
		expect(result.map((s) => s.name)).toEqual(["lint", "build", "test"]);
	});

	test("handles multiple requested steps", () => {
		const steps: Step[] = [
			{ name: "a", cmd: "a" },
			{ name: "b", cmd: "b" },
			{ name: "c", cmd: "c" },
		];

		const result = resolveStepsWithDeps(steps, ["a", "c"]);
		expect(result.map((s) => s.name)).toEqual(["a", "c"]);
	});

	test("preserves original step order from input", () => {
		const steps: Step[] = [
			{ name: "z", cmd: "z" },
			{ name: "a", cmd: "a" },
			{ name: "m", cmd: "m" },
		];

		const result = resolveStepsWithDeps(steps, ["a", "z", "m"]);
		// Order should match original steps array
		expect(result.map((s) => s.name)).toEqual(["z", "a", "m"]);
	});

	test("throws on circular dependency", () => {
		const steps: Step[] = [
			{ name: "a", cmd: "a", dependsOn: ["b"] },
			{ name: "b", cmd: "b", dependsOn: ["a"] },
		];

		expect(() => resolveStepsWithDeps(steps, ["a"])).toThrow(
			/Circular dependency detected/,
		);
	});

	test("throws on self-dependency", () => {
		const steps: Step[] = [{ name: "a", cmd: "a", dependsOn: ["a"] }];

		expect(() => resolveStepsWithDeps(steps, ["a"])).toThrow(
			/Circular dependency detected/,
		);
	});

	test("throws on missing step", () => {
		const steps: Step[] = [{ name: "a", cmd: "a" }];

		expect(() => resolveStepsWithDeps(steps, ["b"])).toThrow(
			/Step "b" not found/,
		);
	});

	test("throws on missing dependency", () => {
		const steps: Step[] = [{ name: "a", cmd: "a", dependsOn: ["missing"] }];

		expect(() => resolveStepsWithDeps(steps, ["a"])).toThrow(
			/Step "missing" not found/,
		);
	});

	test("handles empty requested names", () => {
		const steps: Step[] = [{ name: "a", cmd: "a" }];

		const result = resolveStepsWithDeps(steps, []);
		expect(result).toEqual([]);
	});

	test("handles steps with no dependsOn field", () => {
		const steps: Step[] = [{ name: "a", cmd: "a" }];

		const result = resolveStepsWithDeps(steps, ["a"]);
		expect(result.map((s) => s.name)).toEqual(["a"]);
	});
});

describe("prepareWorkflowSteps", () => {
	test("allows top-level steps to depend on nested steps by parent.child id", () => {
		const steps: Step[] = [
			{
				name: "group",
				steps: [
					{ name: "lint", cmd: "lint" },
					{ name: "test", cmd: "test", dependsOn: ["lint"] },
				],
			},
			{ name: "after", cmd: "after", dependsOn: ["group.test"] },
		];

		const result = prepareWorkflowSteps(steps);

		expect(result[1]?.dependsOn).toEqual(["group"]);
		expect(result[0]?.steps?.[1]?.dependsOn).toEqual(["lint"]);
	});

	test("promotes nested dependencies on top-level steps to the parent group", () => {
		const steps: Step[] = [
			{
				name: "group",
				steps: [
					{ name: "line-count", cmd: "line-count", dependsOn: ["lint"] },
					{ name: "boundary", cmd: "boundary", dependsOn: ["lint"] },
				],
			},
			{ name: "lint", cmd: "lint" },
		];

		const result = prepareWorkflowSteps(steps);

		expect(result[0]?.dependsOn).toEqual(["lint"]);
		expect(result[0]?.steps?.[0]?.dependsOn).toBeUndefined();
		expect(result[0]?.steps?.[1]?.dependsOn).toBeUndefined();
	});

	test("prefers sibling nested steps for unqualified child dependencies", () => {
		const steps: Step[] = [
			{ name: "lint", cmd: "top-lint" },
			{
				name: "group",
				steps: [
					{ name: "lint", cmd: "nested-lint" },
					{ name: "test", cmd: "test", dependsOn: ["lint"] },
				],
			},
		];

		const result = prepareWorkflowSteps(steps);

		expect(result[1]?.dependsOn).toBeUndefined();
		expect(result[1]?.steps?.[1]?.dependsOn).toEqual(["lint"]);
	});

	test("detects cycles that cross top-level and nested steps", () => {
		const steps: Step[] = [
			{ name: "lint", cmd: "lint", dependsOn: ["group.line-count"] },
			{
				name: "group",
				steps: [{ name: "line-count", cmd: "line-count", dependsOn: ["lint"] }],
			},
		];

		expect(() => prepareWorkflowSteps(steps)).toThrow(
			/Circular dependency detected/,
		);
	});

	test("detects self dependencies inside nested groups", () => {
		const steps: Step[] = [
			{
				name: "group",
				steps: [{ name: "lint", cmd: "lint", dependsOn: ["lint"] }],
			},
		];

		expect(() => prepareWorkflowSteps(steps)).toThrow(
			/Circular dependency detected/,
		);
	});
});
