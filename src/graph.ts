/**
 * Dependency graph utilities.
 */

import type { Step } from "./types";

type StepNode = {
	readonly children: StepNode[];
	readonly id: string;
	readonly name: string;
	readonly parentId: string | undefined;
	readonly step: Step;
};

type StepIndex = {
	readonly nodes: readonly StepNode[];
	readonly nodeMap: ReadonlyMap<string, StepNode>;
	readonly roots: readonly StepNode[];
};

function joinStepId(parentId: string | undefined, name: string): string {
	return parentId ? `${parentId}.${name}` : name;
}

function indexStepNodes(steps: readonly Step[]): StepIndex {
	const nodes: StepNode[] = [];
	const nodeMap = new Map<string, StepNode>();

	function visit(
		stepList: readonly Step[],
		parentId: string | undefined,
	): StepNode[] {
		const result: StepNode[] = [];

		for (const step of stepList) {
			const id = joinStepId(parentId, step.name);
			if (nodeMap.has(id)) {
				throw new Error(`Duplicate step name detected: "${id}"`);
			}

			const node: StepNode = {
				children: [],
				id,
				name: step.name,
				parentId,
				step,
			};
			nodeMap.set(id, node);
			nodes.push(node);
			node.children.push(...visit(step.steps ?? [], id));
			result.push(node);
		}

		return result;
	}

	const roots = visit(steps, undefined);
	return { nodes, nodeMap, roots };
}

function resolveDependencyId(
	ref: string,
	from: StepNode,
	nodeMap: ReadonlyMap<string, StepNode>,
): string {
	if (from.parentId) {
		const siblingId = joinStepId(from.parentId, ref);
		if (nodeMap.has(siblingId)) return siblingId;
	}

	if (nodeMap.has(ref)) return ref;
	throw new Error(`Step "${ref}" not found`);
}

function resolveExplicitDependencies(
	nodes: readonly StepNode[],
	nodeMap: ReadonlyMap<string, StepNode>,
): Map<string, string[]> {
	const resolved = new Map<string, string[]>();

	for (const node of nodes) {
		resolved.set(
			node.id,
			(node.step.dependsOn ?? []).map((dep) =>
				resolveDependencyId(dep, node, nodeMap),
			),
		);
	}

	return resolved;
}

function addEdge(
	edges: Map<string, Set<string>>,
	from: string,
	to: string,
): void {
	const deps = edges.get(from);
	if (deps) {
		deps.add(to);
		return;
	}
	edges.set(from, new Set([to]));
}

function buildValidationEdges(
	index: StepIndex,
	resolvedDeps: ReadonlyMap<string, readonly string[]>,
): Map<string, Set<string>> {
	const edges = new Map<string, Set<string>>();

	for (const node of index.nodes) {
		edges.set(node.id, new Set(resolvedDeps.get(node.id) ?? []));
		for (const child of node.children) {
			addEdge(edges, node.id, child.id);
		}
	}

	function addInheritedDeps(
		node: StepNode,
		inheritedDeps: readonly string[],
	): void {
		for (const dep of inheritedDeps) {
			addEdge(edges, node.id, dep);
		}

		const nextInheritedDeps = [
			...inheritedDeps,
			...(resolvedDeps.get(node.id) ?? []),
		];
		for (const child of node.children) {
			addInheritedDeps(child, nextInheritedDeps);
		}
	}

	for (const root of index.roots) {
		addInheritedDeps(root, []);
	}

	return edges;
}

function assertAcyclic(edges: ReadonlyMap<string, ReadonlySet<string>>): void {
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const stack: string[] = [];

	function visit(id: string): void {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			const cycleStart = stack.indexOf(id);
			const cycle = [...stack.slice(cycleStart), id].join(" -> ");
			throw new Error(`Circular dependency detected: ${cycle}`);
		}

		visiting.add(id);
		stack.push(id);
		for (const dep of edges.get(id) ?? []) {
			visit(dep);
		}
		stack.pop();
		visiting.delete(id);
		visited.add(id);
	}

	for (const id of edges.keys()) {
		visit(id);
	}
}

function getDirectChildInScope(
	targetId: string,
	scopeId: string | undefined,
	nodeMap: ReadonlyMap<string, StepNode>,
): StepNode | undefined {
	let current = nodeMap.get(targetId);

	while (current && current.parentId !== scopeId) {
		if (current.parentId === undefined) return undefined;
		current = nodeMap.get(current.parentId);
	}

	return current;
}

function buildRuntimeDependencies(
	index: StepIndex,
	resolvedDeps: ReadonlyMap<string, readonly string[]>,
): Map<string, Set<string>> {
	const runtimeDeps = new Map<string, Set<string>>(
		index.nodes.map((node) => [node.id, new Set<string>()]),
	);

	function addRuntimeDependency(from: StepNode, targetId: string): void {
		let current: StepNode | undefined = from;

		while (current) {
			const directChild = getDirectChildInScope(
				targetId,
				current.parentId,
				index.nodeMap,
			);

			if (directChild) {
				if (directChild.id !== current.id) {
					runtimeDeps.get(current.id)?.add(directChild.name);
				}
				return;
			}

			current = current.parentId
				? index.nodeMap.get(current.parentId)
				: undefined;
		}
	}

	for (const node of index.nodes) {
		for (const dep of resolvedDeps.get(node.id) ?? []) {
			addRuntimeDependency(node, dep);
		}
	}

	return runtimeDeps;
}

function cloneStepTree(
	node: StepNode,
	runtimeDeps: ReadonlyMap<string, ReadonlySet<string>>,
): Step {
	const { dependsOn: _dependsOn, steps: _steps, ...rest } = node.step;
	const deps = [...(runtimeDeps.get(node.id) ?? [])];
	const children = node.children.map((child) =>
		cloneStepTree(child, runtimeDeps),
	);

	return {
		...rest,
		...(deps.length > 0 ? { dependsOn: deps } : {}),
		...(children.length > 0 ? { steps: children } : {}),
	};
}

/**
 * Validates and normalizes workflow dependency references.
 *
 * Nested steps are addressed outside their parent as `parent.child`.
 * Runtime dependencies are normalized back to the direct children each scheduler
 * can enforce while validation still checks the exact hierarchical graph.
 */
export function prepareWorkflowSteps(steps: readonly Step[]): Step[] {
	const index = indexStepNodes(steps);
	const resolvedDeps = resolveExplicitDependencies(index.nodes, index.nodeMap);
	const validationEdges = buildValidationEdges(index, resolvedDeps);
	assertAcyclic(validationEdges);
	const runtimeDeps = buildRuntimeDependencies(index, resolvedDeps);

	return index.roots.map((root) => cloneStepTree(root, runtimeDeps));
}

/**
 * Resolves a set of steps and all their transitive dependencies.
 *
 * @param steps - All available steps
 * @param requestedNames - Names of steps to include
 * @returns Steps in dependency order (dependencies first)
 * @throws Error if circular dependency or missing step detected
 *
 * @example
 * ```ts
 * const steps = [
 *   { name: "build", dependsOn: ["lint"] },
 *   { name: "lint" },
 *   { name: "test", dependsOn: ["build"] },
 * ];
 * resolveStepsWithDeps(steps, ["test"]);
 * // Returns: [lint, build, test]
 * ```
 */
export function resolveStepsWithDeps(
	steps: readonly Step[],
	requestedNames: readonly string[],
): Step[] {
	const stepMap = new Map(steps.map((s) => [s.name, s]));
	const needed = new Set<string>();
	const visiting = new Set<string>();

	function addWithDeps(name: string): void {
		if (needed.has(name)) return;
		if (visiting.has(name)) {
			throw new Error(`Circular dependency detected involving step: "${name}"`);
		}
		const step = stepMap.get(name);
		if (!step) throw new Error(`Step "${name}" not found`);

		visiting.add(name);
		for (const dep of step.dependsOn ?? []) {
			addWithDeps(dep);
		}
		visiting.delete(name);
		needed.add(name);
	}

	for (const name of requestedNames) {
		addWithDeps(name);
	}

	return steps.filter((s) => needed.has(s.name));
}
