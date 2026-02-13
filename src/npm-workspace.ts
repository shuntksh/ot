/**
 * Workspace discovery and dependency graph construction.
 *
 * Provides turborepo-style dependency resolution for workspace packages.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Workspace package metadata.
 */
export type WorkspacePackage = {
	readonly name: string;
	readonly path: string;
	readonly scripts: Readonly<Record<string, string>>;
	readonly workspaceDeps: readonly string[];
};

/**
 * Execution plan for a task in the dependency graph.
 */
export type TaskNode = {
	readonly packageName: string;
	readonly packagePath: string;
	readonly script: string;
	readonly dependencies: readonly string[]; // "package#script" format
};

/**
 * Parses workspace patterns from package.json.
 * Supports both array and object with packages field.
 */
function parseWorkspacePatterns(
	workspaces: unknown,
): readonly string[] | undefined {
	if (Array.isArray(workspaces)) {
		return workspaces.filter((w): w is string => typeof w === "string");
	}
	if (
		typeof workspaces === "object" &&
		workspaces !== null &&
		"packages" in workspaces
	) {
		const packages = (workspaces as { packages: unknown }).packages;
		if (Array.isArray(packages)) {
			return packages.filter((p): p is string => typeof p === "string");
		}
	}
	return undefined;
}

/**
 * Discovers all workspace packages from package.json.
 * Parses the `workspaces.packages` or `workspaces` array field.
 *
 * @param gitRoot - The root directory containing package.json
 * @returns Array of workspace package metadata
 */
export async function discoverWorkspaces(
	gitRoot: string,
): Promise<readonly WorkspacePackage[]> {
	const rootPkgPath = join(gitRoot, "package.json");
	if (!existsSync(rootPkgPath)) {
		throw new Error(`No package.json found at ${rootPkgPath}`);
	}

	const rootPkg = await Bun.file(rootPkgPath).json();
	const patterns = parseWorkspacePatterns(rootPkg.workspaces);

	if (!patterns || patterns.length === 0) {
		return [];
	}

	const packages: WorkspacePackage[] = [];
	const packageNameToPath = new Map<string, string>();

	// Expand glob patterns to find package directories
	for (const pattern of patterns) {
		const glob = new Bun.Glob(pattern);
		const matches = await Array.fromAsync(
			glob.scan({ cwd: gitRoot, absolute: false, onlyFiles: false }),
		);

		for (const match of matches) {
			const pkgPath = join(gitRoot, match);
			const pkgJsonPath = join(pkgPath, "package.json");

			if (!existsSync(pkgJsonPath)) {
				continue;
			}

			const pkgJson = await Bun.file(pkgJsonPath).json();
			const name = pkgJson.name;

			if (!name || typeof name !== "string") {
				continue;
			}

			packageNameToPath.set(name, pkgPath);
		}
	}

	// Second pass: resolve workspace dependencies
	for (const [name, pkgPath] of packageNameToPath) {
		const pkgJsonPath = join(pkgPath, "package.json");
		const pkgJson = await Bun.file(pkgJsonPath).json();

		const allDeps: string[] = [];
		const deps = pkgJson.dependencies ?? {};
		const devDeps = pkgJson.devDependencies ?? {};
		const optDeps = pkgJson.optionalDependencies ?? {};

		for (const depName of Object.keys({ ...deps, ...devDeps, ...optDeps })) {
			// Check if this dependency is a workspace package
			if (packageNameToPath.has(depName)) {
				allDeps.push(depName);
			}
		}

		packages.push({
			name,
			path: pkgPath,
			scripts: pkgJson.scripts ?? {},
			workspaceDeps: allDeps,
		});
	}

	return packages;
}

/**
 * Builds a dependency graph from workspace packages.
 * Returns adjacency list where edges point from package to its dependencies.
 *
 * @param packages - Array of workspace packages
 * @returns Map of package name to its workspace dependency names
 */
export function buildDependencyGraph(
	packages: readonly WorkspacePackage[],
): Map<string, readonly string[]> {
	const graph = new Map<string, readonly string[]>();

	for (const pkg of packages) {
		graph.set(pkg.name, pkg.workspaceDeps);
	}

	return graph;
}

/**
 * Resolves task dependencies using turborepo semantics:
 * - `^task`: Run task in all dependency packages first
 * - `task`: Run another task in the same package first (N/A for workspace-level)
 * - `package#task`: Run specific package's task first
 *
 * @param script - The script to run
 * @param dependsOn - Turborepo-style dependency specifications
 * @param packages - Available workspace packages
 * @param dependencyGraph - Package dependency graph
 * @returns Array of task nodes representing the execution plan
 */
export function resolveTaskDependencies(
	script: string,
	dependsOn: readonly string[],
	packages: readonly WorkspacePackage[],
	dependencyGraph: Map<string, readonly string[]>,
): readonly TaskNode[] {
	const taskNodes = new Map<string, TaskNode>();
	const packageMap = new Map(packages.map((p) => [p.name, p]));

	function resolve(pkgName: string, taskScript: string): void {
		const taskId = `${pkgName}#${taskScript}`;
		if (taskNodes.has(taskId)) return;

		const pkg = packageMap.get(pkgName);
		if (!pkg || !(taskScript in pkg.scripts)) return;

		const deps: string[] = [];

		// For the root script, use the provided dependsOn.
		// For subsequent tasks (like build if we are resolving test -> build),
		// we might want to look up their own dependsOn from a global config,
		// but since we don't have that yet, we'll just handle the top-level dependsOn
		// and the ^task recursive dependencies.

		const currentDependsOn = taskScript === script ? dependsOn : [];

		for (const depSpec of currentDependsOn) {
			if (depSpec.startsWith("^")) {
				const depTask = depSpec.slice(1);
				const workspaceDeps = dependencyGraph.get(pkgName) ?? [];
				for (const workspaceDep of workspaceDeps) {
					const depPkg = packageMap.get(workspaceDep);
					if (depPkg && depTask in depPkg.scripts) {
						const depId = `${workspaceDep}#${depTask}`;
						deps.push(depId);
						resolve(workspaceDep, depTask);
					}
				}
			} else if (depSpec.includes("#")) {
				const [depPkgName, depTask] = depSpec.split("#");
				if (depPkgName && depTask) {
					const targetPkg = packageMap.get(depPkgName);
					if (targetPkg && depTask in targetPkg.scripts) {
						deps.push(depSpec);
						resolve(depPkgName, depTask);
					}
				}
			} else {
				// Same package dependency
				const depTask = depSpec;
				if (depTask in pkg.scripts && depTask !== taskScript) {
					deps.push(`${pkgName}#${depTask}`);
					resolve(pkgName, depTask);
				}
			}
		}

		taskNodes.set(taskId, {
			packageName: pkgName,
			packagePath: pkg.path,
			script: taskScript,
			dependencies: deps,
		});
	}

	const packagesWithRootScript = packages.filter((p) => script in p.scripts);
	for (const pkg of packagesWithRootScript) {
		resolve(pkg.name, script);
	}

	return Array.from(taskNodes.values());
}

/**
 * Topologically sorts task nodes respecting dependencies.
 * Groups nodes that can run in parallel.
 *
 * @param nodes - Task nodes to sort
 * @returns Array of parallel execution layers
 */
export function topologicalSort(
	nodes: readonly TaskNode[],
): readonly (readonly TaskNode[])[] {
	if (nodes.length === 0) {
		return [];
	}

	const nodeMap = new Map(
		nodes.map((n) => [`${n.packageName}#${n.script}`, n]),
	);
	const inDegree = new Map<string, number>();
	const layers: TaskNode[][] = [];

	// Initialize in-degrees
	for (const node of nodes) {
		const id = `${node.packageName}#${node.script}`;
		inDegree.set(id, 0);
	}

	// Calculate in-degrees
	for (const node of nodes) {
		for (const dep of node.dependencies) {
			if (nodeMap.has(dep)) {
				const id = `${node.packageName}#${node.script}`;
				inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
			}
		}
	}

	// Process nodes layer by layer
	const remaining = new Set(nodes.map((n) => `${n.packageName}#${n.script}`));

	while (remaining.size > 0) {
		// Find all nodes with in-degree 0
		const layer: TaskNode[] = [];

		for (const id of remaining) {
			if ((inDegree.get(id) ?? 0) === 0) {
				const node = nodeMap.get(id);
				if (node) {
					layer.push(node);
				}
			}
		}

		if (layer.length === 0) {
			// Circular dependency detected
			throw new Error(
				`Circular dependency detected in tasks: ${[...remaining].join(", ")}`,
			);
		}

		// Remove processed nodes and update in-degrees
		for (const node of layer) {
			const id = `${node.packageName}#${node.script}`;
			remaining.delete(id);

			// Update in-degrees of dependents
			for (const otherNode of nodes) {
				if (otherNode.dependencies.includes(id)) {
					const otherId = `${otherNode.packageName}#${otherNode.script}`;
					inDegree.set(otherId, (inDegree.get(otherId) ?? 1) - 1);
				}
			}
		}

		layers.push(layer);
	}

	return layers;
}
