import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { $ } from "bun";
import { tmpdir } from "node:os";

export type TestProject = {
	dir: string;
	cleanup: () => Promise<void>;
	writeJson: (path: string, content: unknown) => Promise<void>;
	writeFile: (path: string, content: string) => Promise<void>;
	runCLI: (args: string[]) => Promise<{
		exitCode: number;
		stdout: string;
		stderr: string;
		output: string;
	}>;
	gitCommit: (message: string) => Promise<void>;
};

export async function createTestProject(name: string): Promise<TestProject> {
	const dir = join(
		tmpdir(),
		`ot-test-${name}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(dir, { recursive: true });

	// Initialize git repo
	await $`git init`.cwd(dir).quiet();
	await $`git config user.email "test@example.com"`.cwd(dir).quiet();
	await $`git config user.name "Test User"`.cwd(dir).quiet();

	const cliPath = join(process.cwd(), "src/cmd.ts");

	return {
		dir,
		cleanup: async () => {
			await rm(dir, { recursive: true, force: true });
		},
		writeJson: async (path: string, content: unknown) => {
			const fullPath = join(dir, path);
			await mkdir(dirname(fullPath), { recursive: true });
			await writeFile(fullPath, JSON.stringify(content, null, 2));
		},
		writeFile: async (path: string, content: string) => {
			const fullPath = join(dir, path);
			await mkdir(dirname(fullPath), { recursive: true });
			await writeFile(fullPath, content);
		},
		runCLI: async (args: string[]) => {
			// Use bun run to execute the TS file directly
			const result = await $`bun run ${cliPath} ${args}`
				.cwd(dir)
				.nothrow()
				.quiet();
			return {
				exitCode: result.exitCode,
				stdout: result.stdout.toString(),
				stderr: result.stderr.toString(),
				output: result.text(),
			};
		},
		gitCommit: async (message: string) => {
			await $`git add .`.cwd(dir).quiet();
			await $`git commit -m "${message}"`.cwd(dir).quiet();
		},
	};
}
