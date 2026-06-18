/**
 * Command execution action.
 */

import { $ } from "bun";
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
		const result = await $`${{ raw: command }}`
			.env({
				...process.env,
				...createChangedFilesEnv(changedFiles),
			})
			.quiet()
			.nothrow();
		const stdout = result.text();
		const stderr = result.stderr.toString();
		const output = stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");
		const success = result.exitCode === 0;

		if (options.verbose && output.trim()) {
			console.log(output);
		}

		return { success, output };
	});
}
