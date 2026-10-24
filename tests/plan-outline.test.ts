/**
 * Phone plan list: each node once, roots first, children nested under the
 * first parent that reaches them. Cycles do not loop.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planOutlineRows } from "../components/plan-outline.tsx";

describe("planOutlineRows", () => {
	it("nests dependencies and lists a root with no incoming edge first", () => {
		const rows = planOutlineRows(
			[
				{ id: "goal" },
				{ id: "base" },
				{ id: "mid" },
			],
			[
				{ from: "base", to: "mid" },
				{ from: "mid", to: "goal" },
			],
		);
		assert.deepEqual(
			rows.map((row) => [row.id, row.depth, row.hasChildren]),
			[
				["base", 0, true],
				["mid", 1, true],
				["goal", 2, false],
			],
		);
	});

	it("places a node once when two parents point at it, and does not loop on a cycle", () => {
		const rows = planOutlineRows(
			[{ id: "a" }, { id: "b" }, { id: "c" }],
			[
				{ from: "a", to: "c" },
				{ from: "b", to: "c" },
				{ from: "c", to: "a" },
			],
		);
		const ids = rows.map((row) => row.id);
		assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) === i), ids);
		assert.equal(ids.length, 3);
		assert.ok(ids.includes("a") && ids.includes("b") && ids.includes("c"));
	});
});
