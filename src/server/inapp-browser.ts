/**
 * The HTTP face of the in-app browser. app/ routes come through the
 * server barrel; the session itself lives next to the agent tools.
 */
export {
	browserCommand,
	browserFrame,
	browserState,
	peekBrowserPage,
	type BrowserCommand,
	type BrowserState,
} from "../agent/browser-session.ts";
