/**
 * Command execution action.
 */

import { appendShellArgs, createChangedFilesEnv } from "../changed-files";
import { type ActionResult, withTiming } from "./types";

/**
 * Options for running a command action.
 */
export type CmdActionOptions = {
	readonly verbose: boolean;
	readonly appendChangedFiles?: boolean;
	readonly changedFiles?: readonly string[];
	readonly changedFilesSpecified?: boolean;
};

function getShellCommand(command: string): string[] {
	if (process.platform === "win32") {
		return ["cmd.exe", "/d", "/s", "/c", command];
	}
	return ["sh", "-c", command];
}

async function readPipe(
	stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
	if (!stream) return "";

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let output = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		output += decoder.decode(value, { stream: true });
	}

	output += decoder.decode();
	return output;
}

/**
 * Runs a shell command and returns the result.
 *
 * @param cmd - The command string to execute
 * @param options - Action options
 * @returns Action result with success, output, and duration
 */
export async function runCmdAction(
	cmd: string,
	options: CmdActionOptions,
): Promise<ActionResult> {
	return withTiming(async () => {
		const changedFiles = options.changedFiles ?? [];
		if (options.appendChangedFiles && options.changedFilesSpecified) {
			if (changedFiles.length === 0) {
				return {
					success: true,
					output: "No changed files",
				};
			}
		}

		const command =
			options.appendChangedFiles && changedFiles.length > 0
				? appendShellArgs(cmd, changedFiles)
				: cmd;

		const proc = Bun.spawn(getShellCommand(command), {
			env: {
				...process.env,
				...createChangedFilesEnv(changedFiles),
			},
			stderr: "pipe",
			stdin: "ignore",
			stdout: "pipe",
		});

		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			readPipe(proc.stdout),
			readPipe(proc.stderr),
		]);
		const output = stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");
		const success = exitCode === 0;

		if (options.verbose && output.trim()) {
			console.log(output);
		}

		return { success, output };
	});
}
