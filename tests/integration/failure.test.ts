import { describe, expect, test } from "bun:test";
import { createTestProject } from "./utils";

describe("Integration: Failure Handling", () => {
	test("should fail fast by default", async () => {
		const project = await createTestProject("fail-fast");

		await project.writeJson("workflows.json", {
			"fail-job": {
				steps: [
					{ name: "bad-step", cmd: "exit 1" },
					{ name: "good-step", cmd: "echo 'should not run'" },
				],
			},
		});

		const result = await project.runCLI(["fail-job"]);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("FAILED: bad-step");
		expect(result.output).not.toContain("should not run"); // Should be skipped
		expect(result.output).toContain("1 failed");

		await project.cleanup();
	});

	test("should report workspace script failures with full output", async () => {
		const project = await createTestProject("workspace-fail");

		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["packages/*"],
		});

		await project.writeJson("packages/broken/package.json", {
			name: "broken-pkg",
			scripts: {
				oops: "echo 'I am failing'; echo 'stderr details' >&2; exit 1",
			},
		});

		await project.writeJson("workflows.json", {
			"run-broken": {
				steps: [{ name: "test", bun: { script: "oops" } }],
			},
		});

		const result = await project.runCLI(["run-broken"]);

		expect(result.exitCode).toBe(1);
		// Check for the "FAILED" header
		expect(result.output).toContain("FAILED: test");
		// Check for the specific package failure in summary
		expect(result.output).toContain("broken-pkg#oops");
		// Check for consolidated logs
		expect(result.output).toContain("Errors:");
		expect(result.output).toContain("--- broken-pkg#oops ---");
		expect(result.output).toContain("I am failing");
		expect(result.output).toContain("stderr details");

		await project.cleanup();
	});
});
