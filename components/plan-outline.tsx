"use client";

import type { PlanNodeStatus } from "@/src/core";

export interface OutlineSourceNode {
	id: string;
	title: string;
	summary?: string;
}

export interface OutlineNode {
	id: string;
	children: OutlineNode[];
}

export interface OutlineRow {
	id: string;
	depth: number;
	hasChildren: boolean;
}

/**
 * Each node once, under the first parent that reaches it. Roots are nodes
 * with no incoming edge, in authored order. Cycles are skipped. Anything
 * a cycle or a dangling edge never reaches is appended so a rewrite cannot
 * hide a node.
 */
export function planOutlineForest(
	nodes: readonly { id: string }[],
	edges: readonly { from: string; to: string }[],
): OutlineNode[] {
	const ids = new Set(nodes.map((n) => n.id));
	const childrenOf = new Map<string, string[]>();
	const incoming = new Set<string>();
	for (const edge of edges) {
		if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
		incoming.add(edge.to);
		const list = childrenOf.get(edge.from) ?? [];
		list.push(edge.to);
		childrenOf.set(edge.from, list);
	}
	const placed = new Set<string>();
	const build = (id: string, trail: Set<string>): OutlineNode | null => {
		if (!ids.has(id) || placed.has(id) || trail.has(id)) return null;
		placed.add(id);
		const next = new Set(trail);
		next.add(id);
		const children: OutlineNode[] = [];
		for (const kid of childrenOf.get(id) ?? []) {
			const child = build(kid, next);
			if (child) children.push(child);
		}
		return { id, children };
	};
	const forest: OutlineNode[] = [];
	const roots = nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
	for (const id of roots) {
		const node = build(id, new Set());
		if (node) forest.push(node);
	}
	for (const node of nodes) {
		const built = build(node.id, new Set());
		if (built) forest.push(built);
	}
	return forest;
}

export function planOutlineRows(
	nodes: readonly { id: string }[],
	edges: readonly { from: string; to: string }[],
): OutlineRow[] {
	const rows: OutlineRow[] = [];
	const walk = (node: OutlineNode, depth: number) => {
		rows.push({ id: node.id, depth, hasChildren: node.children.length > 0 });
		for (const child of node.children) walk(child, depth + 1);
	};
	for (const root of planOutlineForest(nodes, edges)) walk(root, 0);
	return rows;
}

const STATUS_LABEL: Record<PlanNodeStatus, string> = {
	current: "Current",
	visited: "Visited",
	upcoming: "Upcoming",
};

/**
 * Phone plan: a collapsible list. The graph canvas stays the desktop view;
 * the caller shows this below the sm breakpoint and the canvas above it.
 */
export function PlanOutline({
	nodes,
	edges,
	statusOf,
}: {
	nodes: readonly OutlineSourceNode[];
	edges: readonly { from: string; to: string }[];
	statusOf: (id: string) => PlanNodeStatus;
}) {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const forest = planOutlineForest(nodes, edges);
	if (forest.length === 0) {
		return <p className="px-1 py-3 text-sm text-muted-foreground">No plan yet.</p>;
	}
	const renderNode = (item: OutlineNode, depth: number) => {
		const node = byId.get(item.id);
		if (!node) return null;
		const status = statusOf(item.id);
		const pad = { paddingLeft: `${depth * 16}px` };
		const mark = (
			<span className="flex shrink-0 items-center gap-2">
				<span
					aria-hidden
					className={
						status === "current"
							? "size-2.5 rounded-full bg-primary"
							: status === "visited"
								? "size-2.5 rounded-full bg-muted-foreground"
								: "size-2.5 rounded-full border border-muted-foreground/50"
					}
				/>
				<span className="sr-only">{STATUS_LABEL[status]}</span>
			</span>
		);
		const body = (
			<span className="min-w-0 flex-1">
				<span className="block text-sm text-foreground">{node.title}</span>
				{node.summary ? <span className="mt-0.5 block text-sm text-muted-foreground">{node.summary}</span> : null}
			</span>
		);
		if (item.children.length === 0) {
			return (
				<div
					key={item.id}
					data-testid="plan-outline-node"
					data-node-id={item.id}
					data-status={status}
					className="flex min-h-11 items-start gap-3 border-b border-border/40 py-2"
					style={pad}
				>
					{mark}
					{body}
				</div>
			);
		}
		return (
			<details
				key={item.id}
				open
				data-testid="plan-outline-node"
				data-node-id={item.id}
				data-status={status}
				className="border-b border-border/40"
			>
				<summary
					className="flex min-h-11 cursor-pointer list-none items-start gap-3 py-2 [&::-webkit-details-marker]:hidden"
					style={pad}
				>
					<span aria-hidden className="lh-plan-chevron mt-1 inline-block text-muted-foreground">
						▸
					</span>
					{mark}
					{body}
				</summary>
				<div>{item.children.map((child) => renderNode(child, depth + 1))}</div>
			</details>
		);
	};
	return (
		<div data-testid="plan-outline" className="lh-plan-outline">
			{forest.map((node) => renderNode(node, 0))}
		</div>
	);
}
