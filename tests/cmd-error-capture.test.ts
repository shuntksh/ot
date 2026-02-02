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
});
