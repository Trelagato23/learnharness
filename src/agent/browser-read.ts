import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const MAX_MARKDOWN = 40_000;

/** Readability + Turndown over a live page's HTML. Short pages still return
 *  (a login form is worth reading); only a total parse failure is empty. */
export function readableFromHtml(html: string): { title: string; markdown: string } {
	const { document } = parseHTML(html);
	const article = new Readability(document as unknown as Document).parse();
	const title = article?.title?.trim() || document.title || "";
	let markdown = "";
	if (article?.content) markdown = turndown.turndown(article.content).trim();
	if (!markdown) {
		const text = document.body?.textContent?.replace(/\n{3,}/g, "\n\n").trim() ?? "";
		markdown = text;
	}
	if (markdown.length > MAX_MARKDOWN) {
		markdown = `${markdown.slice(0, MAX_MARKDOWN)}\n\n[Truncated at ${MAX_MARKDOWN} characters]`;
	}
	return { title, markdown };
}
