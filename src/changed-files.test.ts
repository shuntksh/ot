import { describe, expect, test } from "bun:test";
import {
	extractChangedFilesArgv,
	normalizeChangedFiles,
	scopeChangedFilesToDirectory,
} from "./changed-files";

describe("extractChangedFilesArgv", () => {
	test("consumes the rest of argv for lefthook-style changed files", () => {
		const result = extractChangedFilesArgv([
			"pre-commit",
			"-v",
			"--changed-files",
			"src/a.ts",
			"src/with space.ts",
		]);

		expect(result.args).toEqual(["pre-commit", "-v"]);
		expect(result.changedFiles).toEqual(["src/a.ts", "src/with space.ts"]);
		expect(result.specified).toBe(true);
	});

	test("supports a separator for paths that look like flags", () => {
		const result = extractChangedFilesArgv([
			"pre-commit",
			"--changed-files",
			"--",
			"-odd.ts",
		]);

		expect(result.args).toEqual(["pre-commit"]);
		expect(result.changedFiles).toEqual(["-odd.ts"]);
	});

	test("supports repeatable single-file flags", () => {
		const result = extractChangedFilesArgv([
			"pre-commit",
			"--changed-file",
			"src/a.ts",
			"--no-color",
			"--changed-file=src/b.ts",
		]);

		expect(result.args).toEqual(["pre-commit", "--no-color"]);
		expect(result.changedFiles).toEqual(["src/a.ts", "src/b.ts"]);
	});
});

describe("changed file path helpers", () => {
	test("normalizes cwd-relative files to git-root-relative files", () => {
		const files = normalizeChangedFiles(
			["src/a.ts", "../b.ts", "src/a.ts"],
			"/repo/packages/app",
			"/repo",
		);

		expect(files).toEqual(["packages/app/src/a.ts", "packages/b.ts"]);
	});

	test("scopes root-relative files to package-relative files", () => {
		const files = scopeChangedFilesToDirectory(
			["packages/app/src/a.ts", "packages/lib/src/b.ts", "README.md"],
			"/repo",
			"/repo/packages/app",
		);

		expect(files).toEqual(["src/a.ts"]);
	});
});
