import { describe, expect, test } from "bun:test";
import { cleanOutput } from "./run";

const TEST_FILTER_LINE_1 = "(pass) Should be removed";
const TEST_FILTER_LINE_2 = "✓ Should also be removed";

describe("cleanOutput", () => {
	test("removes lines starting with (pass) or ✓", () => {
		const input = `Line 1
${TEST_FILTER_LINE_1}
Line 2
  ${TEST_FILTER_LINE_2}
Line 3`;
		const expected = `Line 1
Line 2
Line 3`;
		expect(cleanOutput(input)).toBe(expected);
	});

	test("does not truncate short output", () => {
		const lines = Array.from({ length: 10 }, (_, i) => `Line ${i}`);
		const input = lines.join("\n");
		expect(cleanOutput(input)).toBe(input);
	});

	test("truncates long output", () => {
		// MAX_CONTEXT_LINES is 20, plus 5 head lines.
		// If we have 100 lines, it should keep first 5 and last 20.
		const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`);
		const input = lines.join("\n");
		const output = cleanOutput(input);
		const outputLines = output.split("\n");

		expect(outputLines.length).toBe(5 + 1 + 20); // Head + Msg + Tail
		expect(outputLines[0]).toBe("Line 0");
		expect(outputLines[4]).toBe("Line 4");
		expect(outputLines[5]).toContain("lines hidden");
		expect(outputLines[6]).toBe("Line 80"); // 100 - 20 = Line 80
		expect(outputLines[outputLines.length - 1]).toBe("Line 99");
	});

	test("removes noise and then truncates", () => {
		const lines = Array.from({ length: 100 }, (_, i) =>
			i === 50 ? TEST_FILTER_LINE_1 : `Line ${i}`,
		);
		const input = lines.join("\n");
		const output = cleanOutput(input);
		// Should have removed line 50. Total lines 99.
		// Truncated: 5 + 1 + 20 = 26 lines output.

		// Truncated: 5 + 1 + 20 = 26 lines output.

		expect(output).not.toContain(TEST_FILTER_LINE_1);

		const outputLines = output.split("\n");
		expect(outputLines.length).toBe(26);
	});
});
