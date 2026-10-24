import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachBrowserContext, parseBrowserUrl, viewportPoint } from "../src/core/browser-page.ts";

describe("parseBrowserUrl", () => {
	it("accepts http(s) and adds https to a bare host", () => {
		assert.equal(parseBrowserUrl("https://example.com/a"), "https://example.com/a");
		assert.equal(parseBrowserUrl("example.com/a"), "https://example.com/a");
		assert.equal(parseBrowserUrl("  http://127.0.0.1:3000/login  "), "http://127.0.0.1:3000/login");
	});

	it("rejects non-http schemes and empty input", () => {
		assert.equal(parseBrowserUrl(""), null);
		assert.equal(parseBrowserUrl("javascript:alert(1)"), null);
		assert.equal(parseBrowserUrl("file:///etc/passwd"), null);
		assert.equal(parseBrowserUrl("about:blank"), null);
	});
});

describe("viewportPoint", () => {
	const rect = { left: 10, top: 20, width: 100, height: 50 };

	it("maps a pointer into the screenshot", () => {
		assert.deepEqual(viewportPoint(15.4, 24.6, rect), { x: 5, y: 5 });
	});

	it("returns null outside the element", () => {
		assert.equal(viewportPoint(0, 0, rect), null);
		assert.equal(viewportPoint(10, 20, { left: 0, top: 0, width: 0, height: 10 }), null);
	});
});

describe("attachBrowserContext", () => {
	const page = {
		url: "https://example.com/bkt",
		title: "BKT",
		selection: "",
		markdown: "Belief is a single number.",
	};

	it("leaves the message alone when no page is open", () => {
		assert.equal(attachBrowserContext("hello", null), "hello");
		assert.equal(attachBrowserContext("hello", { ...page, url: "about:blank" }), "hello");
	});

	it("names the open page without dumping it when the message is unrelated", () => {
		const text = attachBrowserContext("what is a prior?", page);
		assert.match(text, /\[In-app browser\] BKT — https:\/\/example.com\/bkt/);
		assert.match(text, /browser_read_page/);
		assert.doesNotMatch(text, /Belief is a single number/);
		assert.match(text, /what is a prior\?$/);
	});

	it("includes the page and the highlight when he asks about this page", () => {
		const text = attachBrowserContext("explain this page", {
			...page,
			selection: "the learn rate T",
		});
		assert.match(text, /Selected text:\nthe learn rate T/);
		assert.match(text, /Page content:\nBelief is a single number\./);
		assert.match(text, /explain this page$/);
	});
});
