import { describe, expect, test } from "bun:test";
import { createTestProject } from "./utils";

describe("Integration: Workspace Actions", () => {
	test("should run scripts across workspace packages", async () => {
		const project = await createTestProject("workspace-basic");

		// Setup workspace structure
		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["packages/*"],
		});

		await project.writeJson("packages/a/package.json", {
			name: "pkg-a",
			scripts: { build: "echo 'building pkg-a'" },
		});

		await project.writeJson("packages/b/package.json", {
			name: "pkg-b",
			scripts: { build: "echo 'building pkg-b'" },
			dependencies: { "pkg-a": "*" },
		});

		await project.writeJson("workflows.json", {
			"build-all": {
				steps: [
					{
						name: "build",
						bun: {
							script: "build",
							dependsOn: ["^build"], // Build deps first
						},
					},
				],
			},
		});

		const result = await project.runCLI(["build-all", "-v"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("[pkg-a] building pkg-a");
		expect(result.output).toContain("[pkg-b] building pkg-b");

		await project.cleanup();
	});

	test("should respect topological order", async () => {
		const project = await createTestProject("workspace-topo");

		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["libs/*", "apps/*"],
		});

		// lib-utils
		await project.writeJson("libs/utils/package.json", {
			name: "lib-utils",
			scripts: { test: "echo 'test utils'" },
		});

		// lib-ui depends on lib-utils
		await project.writeJson("libs/ui/package.json", {
			name: "lib-ui",
			scripts: { test: "echo 'test ui'" },
			dependencies: { "lib-utils": "*" },
		});

		// app depends on lib-ui
		await project.writeJson("apps/web/package.json", {
			name: "web",
			scripts: { test: "echo 'test web'" },
			dependencies: { "lib-ui": "*" },
		});

		await project.writeJson("workflows.json", {
			"test-all": {
				steps: [
					{
						name: "test",
						bun: {
							script: "test",
							dependsOn: ["^test"],
						},
					},
				],
			},
		});

		const result = await project.runCLI(["test-all", "-v"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("All 1 steps passed");

		// Verify all packages ran
		expect(result.output).toContain("[lib-utils] test utils");
		expect(result.output).toContain("[lib-ui] test ui");
		expect(result.output).toContain("[web] test web");

		await project.cleanup();
	});
});
