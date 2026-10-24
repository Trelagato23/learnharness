/**
 * Pure helpers for the in-app browser. No Node, no Chromium — the session
 * and the phone UI both use these so a typed address and a "this page"
 * question mean the same thing on every host.
 */

export interface BrowserPageSnapshot {
	url: string;
	title: string;
	selection: string;
	markdown: string;
}

/** http(s) only. A bare host ("example.com") gets https. */
export function parseBrowserUrl(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (!url.hostname) return null;
	return url.toString();
}

/** Map a pointer event into the screenshot element. Null when it misses. */
export function viewportPoint(
	clientX: number,
	clientY: number,
	rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } | null {
	if (rect.width <= 0 || rect.height <= 0) return null;
	const x = clientX - rect.left;
	const y = clientY - rect.top;
	if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
	return { x: Math.round(x), y: Math.round(y) };
}

const PAGE_MENTION =
	/\b(this|the|current)\s+(page|article|site|tab)\b|\bselected text\b|\bthis selection\b|\bhighlight(?:ed)?\b/i;

/**
 * Prefix a learner message with the open page. A blank tab adds nothing.
 * The full readable text rides along when he refers to the page or has
 * highlighted something; otherwise the agent gets the URL and can call
 * browser_read_page itself.
 */
export function attachBrowserContext(text: string, page: BrowserPageSnapshot | null): string {
	if (!page) return text;
	const url = page.url.trim();
	if (!url || url === "about:blank") return text;
	const selection = page.selection.trim().slice(0, 8_000);
	const aboutPage = PAGE_MENTION.test(text) || selection.length > 0;
	const parts = [`[In-app browser] ${page.title.trim() || "Untitled"} — ${url}`];
	if (selection) parts.push(`Selected text:\n${selection}`);
	if (aboutPage) {
		const body = page.markdown.trim().slice(0, 12_000);
		if (body) parts.push(`Page content:\n${body}`);
	} else {
		parts.push("The learner has this page open in the in-app browser. Call browser_read_page if you need its text.");
	}
	return `${parts.join("\n\n")}\n\n${text}`;
}
