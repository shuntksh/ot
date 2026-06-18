import { describe, expect, test } from "bun:test";
import { createTestProject } from "./utils";

describe("Integration: Basic Workflows", () => {
	test("should show help", async () => {
		const project = await createTestProject("basic-help");
		const result = await project.runCLI(["--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("USAGE:");
		expect(result.output).toContain("Job Runner");
		expect(result.output).toContain("LEFTHOOK / CHANGED FILES:");
		expect(result.output).toContain("ot pre-commit --changed-files");
		expect(result.output).toContain("BUN CACHE:");
		expect(result.output).toContain("success-only");

		await project.cleanup();
	});

	test("should show version", async () => {
		const project = await createTestProject("basic-version");
		const result = await project.runCLI(["--version"]);

		expect(result.exitCode).toBe(0);
		expect(result.output.trim()).toMatch(/^ot \d+\.\d+\.\d+$/);

		await project.cleanup();
	});

	test("should run a simple command step", async () => {
		const project = await createTestProject("basic-cmd");

		await project.writeJson("workflows.json", {
			hello: {
				steps: [{ name: "echo", cmd: "echo 'Hello World'" }],
			},
		});

		const result = await project.runCLI(["hello", "-v"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("Hello World");
		expect(result.output).toContain("passed");

		await project.cleanup();
	});

	test("should handle step dependencies", async () => {
		const project = await createTestProject("basic-deps");

		await project.writeJson("workflows.json", {
			ordered: {
				steps: [
					{ name: "step2", cmd: "echo 'Second'", dependsOn: ["step1"] },
					{ name: "step1", cmd: "echo 'First'" },
				],
			},
		});

		const result = await project.runCLI(["ordered", "-v"]);

		expect(result.exitCode).toBe(0);
		// Note: Output order isn't strictly guaranteed by stdout buffering,
		// but the runner logic ensures sequential start.
		// We check if both ran.
		expect(result.output).toContain("First");
		expect(result.output).toContain("Second");
		expect(result.output).toContain("All 2 steps passed");

		await project.cleanup();
	});

	test("should print invalid JSON errors without a stack trace", async () => {
		const project = await createTestProject("basic-invalid-json");

		await project.writeFile("workflows.json", '{"check":');

		const result = await project.runCLI(["check"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Invalid JSON in");
		expect(result.stderr).not.toContain("at loadConfig");
		expect(result.stderr).not.toContain("Bun v");

		await project.cleanup();
	});

	test("should print semantic config errors with step paths", async () => {
		const project = await createTestProject("basic-invalid-config");

		await project.writeJson("workflows.json", {
			check: {
				steps: [
					{
						name: "lint",
						cmd: "bun biome check --write",
						cache: true,
					},
				],
			},
		});

		const result = await project.runCLI(["check"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Invalid config in workflows.json");
		expect(result.stderr).toContain("workflows.check.steps[0].cache");
		expect(result.stderr).toContain("bun.cache");
		expect(result.stderr).not.toContain("at loadConfig");
		expect(result.stderr).not.toContain("Bun v");

		await project.cleanup();
	});

	test("should run nested substeps sequentially when pararell is false", async () => {
		const project = await createTestProject("basic-nested-sequential");

		await project.writeJson("workflows.json", {
			nested: {
				steps: [
					{
						name: "quality",
						description: "Run quality checks",
						pararell: false,
						steps: [
							{
								name: "first",
								cmd: "sleep 0.2; printf 'one\\n' > order.txt",
							},
							{
								name: "second",
								cmd: "test -f order.txt && printf 'two\\n' >> order.txt",
							},
							{
								name: "show",
								cmd: "cat order.txt",
								dependsOn: ["second"],
							},
						],
					},
				],
			},
		});

		const result = await project.runCLI(["nested", "-v"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("one\ntwo");
		expect(result.output).toContain("All 1 steps passed");

		await project.cleanup();
	});

	test("should respect dependencies inside sequential nested substeps", async () => {
		const project = await createTestProject("basic-nested-deps");

		await project.writeJson("workflows.json", {
			nested: {
				steps: [
					{
						name: "quality",
						pararell: false,
						steps: [
							{
								name: "first",
								cmd: "printf 'first\\n' >> dep-order.txt",
								dependsOn: ["second"],
							},
							{
								name: "second",
								cmd: "printf 'second\\n' > dep-order.txt",
							},
							{
								name: "show",
								cmd: "cat dep-order.txt",
								dependsOn: ["first"],
							},
						],
					},
				],
			},
		});

		const result = await project.runCLI(["nested", "-v"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("second\nfirst");

		await project.cleanup();
	});

	test("should allow nested substeps to depend on top-level steps", async () => {
		const project = await createTestProject("basic-nested-external-deps");

		await project.writeJson("workflows.json", {
			nested: {
				steps: [
					{
						name: "repo-scripts",
						steps: [
							{
								name: "line-count",
								cmd: "test -f lint-done.txt && printf 'line-count\\n' >> nested-order.txt",
								dependsOn: ["lint"],
							},
							{
								name: "boundary",
								cmd: "test -f lint-done.txt && printf 'boundary\\n' >> nested-order.txt",
								dependsOn: ["lint"],
							},
						],
					},
					{
						name: "lint",
						cmd: "printf 'lint\\n' > lint-done.txt",
					},
					{
						name: "show",
						cmd: "cat lint-done.txt nested-order.txt",
						dependsOn: ["repo-scripts"],
					},
				],
			},
		});

		const result = await project.runCLI(["nested", "-v"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("lint");
		expect(result.output).toContain("line-count");
		expect(result.output).toContain("boundary");

		await project.cleanup();
	});

	test("should pass changed files to command steps", async () => {
		const project = await createTestProject("basic-changed-files");

		await project.writeJson("workflows.json", {
			"pre-commit": {
				steps: [
					{
						name: "lint",
						changedFiles: "append",
						cmd: `bun -e "console.log(process.argv.slice(1).join('|')); console.log(process.env.OT_CHANGED_FILES_COUNT)"`,
					},
				],
			},
		});

		const result = await project.runCLI([
			"pre-commit",
			"-v",
			"--changed-files",
			"src/a.ts",
			"src/with space.ts",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("Changed files: 2");
		expect(result.output).toContain("src/a.ts|src/with space.ts");
		expect(result.output).toContain("2");

		await project.cleanup();
	});
});
