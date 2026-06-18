import { describe, expect, test } from "bun:test";
import { join } from "node:path";
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

	test("should pass package-scoped changed files to workspace scripts", async () => {
		const project = await createTestProject("workspace-changed-files");

		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["packages/*"],
		});

		const script = `bun -e "console.log(process.argv.slice(1).join('|')); console.log(process.env.OT_CHANGED_FILES_COUNT)"`;
		await project.writeJson("packages/a/package.json", {
			name: "pkg-a",
			scripts: { lint: script },
		});
		await project.writeJson("packages/b/package.json", {
			name: "pkg-b",
			scripts: { lint: script },
		});
		await project.writeFile("packages/a/src/a.ts", "export const a = 1;\n");
		await project.writeFile("packages/b/src/b.ts", "export const b = 1;\n");

		await project.writeJson("workflows.json", {
			lint: {
				steps: [
					{
						name: "lint",
						bun: { script: "lint", changedFiles: "append" },
					},
				],
			},
		});

		const result = await project.runCLI([
			"lint",
			"-v",
			"--changed-files",
			"packages/a/src/a.ts",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("[pkg-a] src/a.ts");
		expect(result.output).not.toContain("[pkg-b]");

		await project.cleanup();
	});

	test("should cache successful workspace script invocations", async () => {
		const project = await createTestProject("workspace-cache");

		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["packages/*"],
		});
		await project.writeJson("packages/a/package.json", {
			name: "pkg-a",
			scripts: {
				lint: `bun -e "const fs = require('fs'); const p = '../../counter.txt'; const n = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) : 0; fs.writeFileSync(p, String(n + 1)); console.log('run ' + (n + 1));"`,
			},
		});
		await project.writeFile("packages/a/src/a.ts", "export const a = 1;\n");
		await project.writeJson("workflows.json", {
			lint: {
				steps: [
					{
						name: "lint",
						bun: { script: "lint", cache: true },
					},
				],
			},
		});

		const first = await project.runCLI(["lint", "-v"]);
		const second = await project.runCLI(["lint", "-v"]);
		await project.writeFile("packages/a/src/a.ts", "export const a = 2;\n");
		const third = await project.runCLI(["lint", "-v"]);

		expect(first.exitCode).toBe(0);
		expect(first.output).toContain("[pkg-a] run 1");
		expect(second.exitCode).toBe(0);
		expect(second.output).toContain("[pkg-a] cache hit");
		expect(second.output).not.toContain("[pkg-a] run 2");
		expect(third.exitCode).toBe(0);
		expect(third.output).toContain("[pkg-a] run 2");
		expect(await Bun.file(join(project.dir, "counter.txt")).text()).toBe("2");

		await project.cleanup();
	});

	test("should not cache failed workspace script invocations", async () => {
		const project = await createTestProject("workspace-cache-failure");

		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["packages/*"],
		});
		await project.writeJson("packages/a/package.json", {
			name: "pkg-a",
			scripts: {
				lint: `bun -e "const fs = require('fs'); const p = '../../attempt.txt'; const n = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) : 0; fs.writeFileSync(p, String(n + 1)); console.log('attempt ' + (n + 1)); process.exit(n === 0 ? 1 : 0);"`,
			},
		});
		await project.writeFile("packages/a/src/a.ts", "export const a = 1;\n");
		await project.writeJson("workflows.json", {
			lint: {
				steps: [
					{
						name: "lint",
						bun: { script: "lint", cache: true },
					},
				],
			},
		});

		const first = await project.runCLI(["lint", "-v"]);
		const second = await project.runCLI(["lint", "-v"]);

		expect(first.exitCode).toBe(1);
		expect(first.output).toContain("[pkg-a] attempt 1");
		expect(second.exitCode).toBe(0);
		expect(second.output).toContain("[pkg-a] attempt 2");
		expect(second.output).not.toContain("[pkg-a] cache hit");

		await project.cleanup();
	});

	test("should include changed-file argv and global inputs in cache keys", async () => {
		const project = await createTestProject("workspace-cache-key");

		await project.writeJson("package.json", {
			name: "root",
			workspaces: ["packages/*"],
		});
		await project.writeJson("packages/a/package.json", {
			name: "pkg-a",
			scripts: {
				lint: `bun -e "const fs = require('fs'); const p = '../../counter.txt'; const n = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) : 0; fs.writeFileSync(p, String(n + 1)); console.log('run ' + (n + 1) + ' ' + process.argv.slice(1).join('|'));"`,
			},
		});
		await project.writeFile("packages/a/src/a.ts", "export const a = 1;\n");
		await project.writeFile("packages/a/src/b.ts", "export const b = 1;\n");
		await project.writeFile("tool.config", "version=1\n");
		await project.writeJson("workflows.json", {
			lint: {
				steps: [
					{
						name: "lint",
						bun: {
							script: "lint",
							changedFiles: "append",
							cache: {
								inputs: ["src/**/*", "package.json"],
								globalInputs: ["tool.config"],
							},
						},
					},
				],
			},
		});

		const first = await project.runCLI([
			"lint",
			"-v",
			"--changed-files",
			"packages/a/src/a.ts",
		]);
		const second = await project.runCLI([
			"lint",
			"-v",
			"--changed-files",
			"packages/a/src/a.ts",
		]);
		const third = await project.runCLI([
			"lint",
			"-v",
			"--changed-files",
			"packages/a/src/b.ts",
		]);
		await project.writeFile("tool.config", "version=2\n");
		const fourth = await project.runCLI([
			"lint",
			"-v",
			"--changed-files",
			"packages/a/src/b.ts",
		]);

		expect(first.exitCode).toBe(0);
		expect(first.output).toContain("[pkg-a] run 1 src/a.ts");
		expect(second.exitCode).toBe(0);
		expect(second.output).toContain("[pkg-a] cache hit");
		expect(third.exitCode).toBe(0);
		expect(third.output).toContain("[pkg-a] run 2 src/b.ts");
		expect(fourth.exitCode).toBe(0);
		expect(fourth.output).toContain("[pkg-a] run 3 src/b.ts");
		expect(await Bun.file(join(project.dir, "counter.txt")).text()).toBe("3");

		await project.cleanup();
	});
});
