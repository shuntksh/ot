import { describe, expect, test } from "bun:test";
import { runCmdAction } from "../src/actions/cmd";

describe("runCmdAction", () => {
	test("captures stderr", async () => {
		// Command that writes to stderr and fails using Bun script to avoid shell syntax issues
		const cmd = `bun -e "console.error('error message'); process.exit(1)"`;
		const result = await runCmdAction(cmd, { verbose: false });

		expect(result.success).toBe(false);
		expect(result.output).toContain("error message");
	});

	test("passes changed files as argv and env", async () => {
		const cmd = `bun -e "console.log(process.argv.slice(1).join('|')); console.log(process.env.OT_CHANGED_FILES_JSON)"`;
		const result = await runCmdAction(cmd, {
			appendChangedFiles: true,
			changedFiles: ["src/a.ts", "src/with space.ts"],
			changedFilesSpecified: true,
			verbose: false,
		});

		expect(result.success).toBe(true);
		expect(result.output).toContain("src/a.ts|src/with space.ts");
		expect(result.output).toContain('["src/a.ts","src/with space.ts"]');
	});

	test("drains large stdout and stderr while waiting for exit", async () => {
		const cmd = `bun -e "for (let i = 0; i < 3000; i++) console.log('out' + i); for (let i = 0; i < 3000; i++) console.error('err' + i)"`;
		const result = await runCmdAction(cmd, { verbose: false });

		expect(result.success).toBe(true);
		expect(result.output).toContain("out2999");
		expect(result.output).toContain("err2999");
	});
});
