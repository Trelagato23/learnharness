import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import { browserCommand, browserState } from "../browser-session.ts";

/**
 * The in-app browser. One session shared with the pane the learner is
 * looking at — Electron's WebContentsView or the headless Chromium the
 * phone watches. "This page" in his message is that tab.
 */

const navigateInput = Type.Object({
	url: Type.String({ description: "http(s) URL. A bare host is opened as https." }),
});
const readInput = Type.Object({});
const shotInput = Type.Object({});
const clickInput = Type.Object({
	x: Type.Optional(Type.Number({ description: "CSS pixel from the left of the page viewport" })),
	y: Type.Optional(Type.Number({ description: "CSS pixel from the top of the page viewport" })),
	selector: Type.Optional(Type.String({ description: "CSS selector. Used instead of x/y when set." })),
});
const typeInput = Type.Object({
	text: Type.String({ description: "Text to type into the focused element, or into selector when set." }),
	selector: Type.Optional(Type.String({ description: "CSS selector to click before typing." })),
	submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing." })),
});
const scrollInput = Type.Object({
	dy: Type.Optional(Type.Number({ description: "Vertical wheel delta in pixels. Positive scrolls down. Default 480." })),
	dx: Type.Optional(Type.Number({ description: "Horizontal wheel delta in pixels." })),
});

const PAGE =
	"The in-app browser tab the learner is looking at (the pane beside this chat). " +
	"When he says 'this page' or has highlighted text, that tab is what he means.";

export function browserTools(): Record<string, AgentTool<any>> {
	return {
		browser_navigate: {
			name: "browser_navigate",
			label: "browser_navigate",
			description: `${PAGE} Open a URL in it.`,
			parameters: navigateInput,
			execute: serverExecute("browser_navigate", navigateInput, async ({ url }) => {
				const result = await browserCommand({ op: "navigate", url });
				if (!result.ok) return `browser_navigate failed: ${result.error}`;
				return `Opened ${result.state.title || result.state.url} — ${result.state.url}`;
			}),
		},
		browser_read_page: {
			name: "browser_read_page",
			label: "browser_read_page",
			description: `${PAGE} Read it as markdown (Readability), plus the URL, title, and any highlighted text.`,
			parameters: readInput,
			execute: serverExecute("browser_read_page", readInput, async () => {
				const result = await browserCommand({ op: "read" });
				if (!result.ok) return `browser_read_page failed: ${result.error}`;
				const page = result.page;
				if (!page) return "browser_read_page failed: no page";
				const selection = page.selection.trim() ? `\n\nSelected text:\n${page.selection.trim()}` : "";
				return `Title: ${page.title || "(untitled)"}\nURL: ${page.url}${selection}\n\n---\n\n${page.markdown || "(no readable text)"}`;
			}),
		},
		browser_screenshot: {
			name: "browser_screenshot",
			label: "browser_screenshot",
			description: `${PAGE} Take a JPEG screenshot of the current viewport.`,
			parameters: shotInput,
			execute: serverExecute("browser_screenshot", shotInput, async (): Promise<ImageFileResult | string> => {
				const { browserFrame } = await import("../browser-session.ts");
				const frame = await browserFrame();
				const state = await browserState();
				if (!frame) return `browser_screenshot failed: ${state.error || "no image"}`;
				return {
					text: `Screenshot of ${state.title || state.url} — ${state.url}`,
					images: [{ data: frame.toString("base64"), mimeType: "image/jpeg" }],
					details: { url: state.url, title: state.title },
				};
			}),
		},
		browser_click: {
			name: "browser_click",
			label: "browser_click",
			description: `${PAGE} Click a CSS selector, or a point (x, y) in viewport pixels. Take a screenshot first if you are guessing coordinates.`,
			parameters: clickInput,
			execute: serverExecute("browser_click", clickInput, async (input) => {
				if (!input.selector && (typeof input.x !== "number" || typeof input.y !== "number")) {
					return "browser_click failed: pass a selector or both x and y.";
				}
				const result = await browserCommand({ op: "click", x: input.x, y: input.y, selector: input.selector });
				if (!result.ok) return `browser_click failed: ${result.error}`;
				return input.selector ? `Clicked ${input.selector}` : `Clicked (${input.x}, ${input.y})`;
			}),
		},
		browser_type: {
			name: "browser_type",
			label: "browser_type",
			description: `${PAGE} Type text. Optional selector focuses a field first. Set submit true to press Enter.`,
			parameters: typeInput,
			execute: serverExecute("browser_type", typeInput, async ({ text, selector, submit }) => {
				const result = await browserCommand({ op: "type", text, selector, submit });
				if (!result.ok) return `browser_type failed: ${result.error}`;
				return `Typed ${text.length} characters${selector ? ` into ${selector}` : ""}${submit ? " and pressed Enter" : ""}.`;
			}),
		},
		browser_scroll: {
			name: "browser_scroll",
			label: "browser_scroll",
			description: `${PAGE} Scroll the page. Positive dy scrolls down.`,
			parameters: scrollInput,
			execute: serverExecute("browser_scroll", scrollInput, async ({ dx, dy }) => {
				const result = await browserCommand({ op: "scroll", dx, dy });
				if (!result.ok) return `browser_scroll failed: ${result.error}`;
				return `Scrolled by (${dx ?? 0}, ${dy ?? 480}).`;
			}),
		},
	};
}
