import { describe, expect, test } from "bun:test";
import { createColorizer } from "./colors";
import { createProgressPrinter } from "./progress-printer";

function captureLogs(fn: () => void): string {
	const originalLog = console.log;
	const lines: string[] = [];

	console.log = (...args: unknown[]) => {
		lines.push(args.join(" "));
	};

	try {
		fn();
	} finally {
		console.log = originalLog;
	}

	return lines.join("\n");
}

describe("ProgressPrinter", () => {
	const noColor = createColorizer(false);

	test("shows elapsed seconds for a running step", () => {
		const printer = createProgressPrinter(["build"], {
			c: noColor,
			isTTY: false,
		});

		printer.updateStep("build", { status: "running" });
		const output = captureLogs(() => printer.initialRender());

		expect(output).toContain("running... (0s elapsed)");
	});

	test("shows elapsed seconds for running nested tasks", () => {
		const printer = createProgressPrinter(["test"], {
			c: noColor,
			isTTY: false,
		});

		printer.setNested("test", [{ id: "app#test", status: "running" }]);
		const output = captureLogs(() => printer.initialRender());

		expect(output).toContain("app#test");
		expect(output).toContain("(0s elapsed)");
	});
});
