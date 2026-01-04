import { describe, expect, test } from "bun:test";
import { createTestProject } from "./utils";

describe("Reproduction: Output Filtering", () => {
	test("should hide (pass) lines for failing tests when not verbose", async () => {
		const project = await createTestProject("filter-pass-output");

		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["packages/*"],
		});

		await project.writeJson("packages/a/package.json", {
			name: "pkg-a",
			scripts: {
				test: "bun run test.ts",
			},
		});

		await project.writeFile(
			"packages/a/test.ts",
			`
      console.log('(pass) test 1');
      console.log('(pass) test 2');
      console.log('failure details');
      process.exit(1);
    `,
		);

		await project.writeJson("workflows.json", {
			"test-all": {
				steps: [
					{
						name: "test",
						bun: {
							script: "test",
						},
					},
				],
			},
		});

		// Run WITHOUT -v
		const result = await project.runCLI(["test-all"]);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("failure details");
		// These should be hidden by default
		expect(result.output).not.toContain("(pass) test 1");
		expect(result.output).not.toContain("(pass) test 2");

		await project.cleanup();
	});

	test("should SHOW (pass) lines for failing tests when verbose", async () => {
		const project = await createTestProject("filter-pass-output-verbose");

		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["packages/*"],
		});

		await project.writeJson("packages/a/package.json", {
			name: "pkg-a",
			scripts: {
				test: "bun run test.ts",
			},
		});

		await project.writeFile(
			"packages/a/test.ts",
			`
      console.log('(pass) test 1');
      console.log('(pass) test 2');
      console.log('failure details');
      process.exit(1);
    `,
		);

		await project.writeJson("workflows.json", {
			"test-all": {
				steps: [
					{
						name: "test",
						bun: {
							script: "test",
						},
					},
				],
			},
		});

		// Run WITH -v
		const result = await project.runCLI(["test-all", "-v"]);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("failure details");
		// These should be visible when verbose
		expect(result.output).toContain("(pass) test 1");
		expect(result.output).toContain("(pass) test 2");

		await project.cleanup();
	});
});
