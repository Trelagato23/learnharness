/**
 * One in-app browser for this process.
 *
 * Electron sets LH_BROWSER_BRIDGE (or writes the same pair into a temp
 * file) and the session drives that WebContentsView. Everywhere else —
 * the phone, `npm run headless`, `next dev` — this launches headless
 * Chromium through puppeteer-core and streams JPEG frames.
 *
 * Personal use: a single user, a handful of tabs, no isolation between
 * them beyond the existing login on the HTTP API.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BrowserPageSnapshot } from "../core/browser-page.ts";
import { parseBrowserUrl } from "../core/browser-page.ts";
import { readableFromHtml } from "./browser-read.ts";
import { resolveChromeExecutablePath } from "./subagents/headless.ts";

export interface BrowserTabState {
	id: string;
	url: string;
	title: string;
	active: boolean;
}

export interface BrowserState {
	mode: "electron" | "chromium" | "unavailable";
	error?: string;
	url: string;
	title: string;
	canGoBack: boolean;
	canGoForward: boolean;
	selection: string;
	tabs: BrowserTabState[];
}

export interface BrowserDriver {
	mode: "electron" | "chromium";
	state(): Promise<BrowserState>;
	navigate(url: string): Promise<void>;
	back(): Promise<void>;
	forward(): Promise<void>;
	reload(): Promise<void>;
	read(): Promise<BrowserPageSnapshot>;
	screenshot(): Promise<Buffer>;
	click(target: { x?: number; y?: number; selector?: string }): Promise<void>;
	type(text: string, selector?: string): Promise<void>;
	press(key: string): Promise<void>;
	scroll(dx: number, dy: number): Promise<void>;
	viewport(width: number, height: number): Promise<void>;
	selection(text: string): Promise<void>;
	newTab(url?: string): Promise<void>;
	closeTab(id: string): Promise<void>;
	switchTab(id: string): Promise<void>;
}

/** Test seam. When set, nothing launches. */
export const browserDriverOverride: { current?: BrowserDriver } = {};

const EMPTY: BrowserState = {
	mode: "unavailable",
	url: "about:blank",
	title: "",
	canGoBack: false,
	canGoForward: false,
	selection: "",
	tabs: [],
};

function bridgeFromEnv(): { base: string; token: string } | null {
	const base = process.env.LH_BROWSER_BRIDGE;
	const token = process.env.LH_BROWSER_TOKEN;
	if (base && token) return { base, token };
	try {
		const file = path.join(os.tmpdir(), "learnharness-browser-bridge.json");
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { base?: string; token?: string };
		if (parsed.base && parsed.token) return { base: parsed.base, token: parsed.token };
	} catch {
		/* no Electron bridge */
	}
	return null;
}

async function bridgeCall<T>(bridge: { base: string; token: string }, pathName: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${bridge.base}${pathName}`, {
		...init,
		headers: {
			...(init?.headers ?? {}),
			"x-lh-browser-token": bridge.token,
		},
		signal: AbortSignal.timeout(25_000),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(text || `browser bridge HTTP ${res.status}`);
	}
	if (res.headers.get("content-type")?.includes("image/")) {
		return Buffer.from(await res.arrayBuffer()) as T;
	}
	return (await res.json()) as T;
}

function bridgeDriver(bridge: { base: string; token: string }): BrowserDriver {
	const post = (body: unknown) =>
		bridgeCall<BrowserState>(bridge, "/command", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	return {
		mode: "electron",
		state: () => bridgeCall<BrowserState>(bridge, "/state"),
		navigate: (url) => post({ op: "navigate", url }).then(() => undefined),
		back: () => post({ op: "back" }).then(() => undefined),
		forward: () => post({ op: "forward" }).then(() => undefined),
		reload: () => post({ op: "reload" }).then(() => undefined),
		read: async () => {
			const raw = await bridgeCall<{ url: string; title: string; selection: string; html?: string; markdown?: string }>(
				bridge,
				"/read",
			);
			if (typeof raw.markdown === "string") {
				return { url: raw.url, title: raw.title, selection: raw.selection, markdown: raw.markdown };
			}
			const readable = readableFromHtml(raw.html ?? "");
			return {
				url: raw.url,
				title: raw.title || readable.title,
				selection: raw.selection ?? "",
				markdown: readable.markdown,
			};
		},
		screenshot: () => bridgeCall<Buffer>(bridge, "/frame"),
		click: (target) => post({ op: "click", ...target }).then(() => undefined),
		type: (text, selector) => post({ op: "type", text, selector }).then(() => undefined),
		press: (key) => post({ op: "press", key }).then(() => undefined),
		scroll: (dx, dy) => post({ op: "scroll", dx, dy }).then(() => undefined),
		viewport: (width, height) => post({ op: "viewport", width, height }).then(() => undefined),
		selection: (text) => post({ op: "selection", text }).then(() => undefined),
		newTab: (url) => post({ op: "newTab", url }).then(() => undefined),
		closeTab: (id) => post({ op: "closeTab", id }).then(() => undefined),
		switchTab: (id) => post({ op: "switchTab", id }).then(() => undefined),
	};
}

let chromium: BrowserDriver | null = null;
let chromiumError: string | null = null;
let chromiumLaunch: Promise<BrowserDriver> | null = null;
let booted = false;

async function chromiumDriver(): Promise<BrowserDriver> {
	if (chromium) return chromium;
	if (chromiumError) throw new Error(chromiumError);
	if (chromiumLaunch) return chromiumLaunch;
	chromiumLaunch = launchChromium().finally(() => {
		chromiumLaunch = null;
	});
	return chromiumLaunch;
}

async function launchChromium(): Promise<BrowserDriver> {
	const puppeteer = (await import("puppeteer-core")).default;
	const executablePath = resolveChromeExecutablePath();
	let browser: import("puppeteer-core").Browser;
	try {
		browser = await puppeteer.launch({
			headless: true,
			...(executablePath ? { executablePath } : { channel: "chrome" as const }),
			args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
			defaultViewport: { width: 1100, height: 800 },
		});
	} catch (err) {
		chromiumError =
			err instanceof Error
				? err.message
				: "Could not start Chromium. Set CHROME_PATH to a Chrome or Chromium binary.";
		throw new Error(chromiumError);
	}
	const driver = await createChromiumDriver(browser);
	chromium = driver;
	booted = true;
	return driver;
}

async function createChromiumDriver(browser: import("puppeteer-core").Browser): Promise<BrowserDriver> {
	type Tab = { id: string; page: import("puppeteer-core").Page; frame: Buffer | null };
	let seq = 1;
	const tabs: Tab[] = [];
	let active = 0;
	let pinnedSelection = "";
	let chain: Promise<unknown> = Promise.resolve();
	const serial = <T>(fn: () => Promise<T>): Promise<T> => {
		const run = chain.then(fn, fn);
		chain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};

	const watch = async (tab: Tab) => {
		try {
			const client = await tab.page.createCDPSession();
			await client.send("Page.startScreencast", {
				format: "jpeg",
				quality: 55,
				maxWidth: 1280,
				maxHeight: 900,
				everyNthFrame: 1,
			});
			client.on("Page.screencastFrame", (frame: { data: string; sessionId: number }) => {
				tab.frame = Buffer.from(frame.data, "base64");
				void client.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
			});
		} catch {
			/* screenshot() falls back to page.screenshot */
		}
	};

	const add = async (url?: string): Promise<Tab> => {
		const page = await browser.newPage();
		const tab: Tab = { id: `tab_${seq++}`, page, frame: null };
		tabs.push(tab);
		await watch(tab);
		if (url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
		return tab;
	};
	await add();

	const current = () => tabs[active]!;

	const snapshot = async (tab: Tab): Promise<BrowserPageSnapshot> => {
		const html = await tab.page.content();
		const readable = readableFromHtml(html);
		const live = await tab.page.evaluate(() => window.getSelection()?.toString() ?? "").catch(() => "");
		return {
			url: tab.page.url(),
			title: readable.title || (await tab.page.title()),
			selection: (live || pinnedSelection).trim().slice(0, 8_000),
			markdown: readable.markdown,
		};
	};

	const stateOf = async (): Promise<BrowserState> => {
		const tab = current();
		let canGoBack = false;
		let canGoForward = false;
		try {
			const client = await tab.page.createCDPSession();
			const hist = (await client.send("Page.getNavigationHistory")) as { currentIndex: number; entries: unknown[] };
			canGoBack = hist.currentIndex > 0;
			canGoForward = hist.currentIndex < hist.entries.length - 1;
			await client.detach().catch(() => undefined);
		} catch {
			/* history is a hint for the buttons */
		}
		const live = await tab.page.evaluate(() => window.getSelection()?.toString() ?? "").catch(() => "");
		return {
			mode: "chromium",
			url: tab.page.url(),
			title: await tab.page.title().catch(() => ""),
			canGoBack,
			canGoForward,
			selection: (live || pinnedSelection).trim().slice(0, 8_000),
			tabs: await Promise.all(
				tabs.map(async (t, i) => ({
					id: t.id,
					url: t.page.url(),
					title: (await t.page.title().catch(() => "")) || t.page.url(),
					active: i === active,
				})),
			),
		};
	};

	return {
		mode: "chromium",
		state: () => serial(stateOf),
		navigate: (url) =>
			serial(async () => {
				pinnedSelection = "";
				await current().page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
			}),
		back: () => serial(() => current().page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).then(() => undefined)),
		forward: () =>
			serial(() => current().page.goForward({ waitUntil: "domcontentloaded", timeout: 15_000 }).then(() => undefined)),
		reload: () => serial(() => current().page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }).then(() => undefined)),
		read: () => serial(() => snapshot(current())),
		screenshot: () =>
			serial(async () => {
				const tab = current();
				if (tab.frame && tab.frame.length > 0) return tab.frame;
				const buf = await tab.page.screenshot({ type: "jpeg", quality: 55 });
				return Buffer.from(buf);
			}),
		click: (target) =>
			serial(async () => {
				const page = current().page;
				if (target.selector) {
					await page.click(target.selector, { delay: 20 });
					return;
				}
				if (typeof target.x === "number" && typeof target.y === "number") {
					await page.mouse.click(target.x, target.y);
					return;
				}
				throw new Error("click needs a selector or x and y");
			}),
		type: (text, selector) =>
			serial(async () => {
				const page = current().page;
				if (selector) await page.click(selector);
				await page.keyboard.type(text, { delay: 10 });
			}),
		press: (key) => serial(() => current().page.keyboard.press(key as "Enter")),
		scroll: (dx, dy) => serial(() => current().page.mouse.wheel({ deltaX: dx, deltaY: dy })),
		viewport: (width, height) =>
			serial(() =>
				current().page.setViewport({
					width: Math.max(320, Math.min(1600, Math.round(width))),
					height: Math.max(320, Math.min(1400, Math.round(height))),
				}),
			),
		selection: (text) =>
			serial(async () => {
				pinnedSelection = text.slice(0, 8_000);
			}),
		newTab: (url) =>
			serial(async () => {
				const tab = await add(url);
				active = tabs.indexOf(tab);
				await tab.page.bringToFront();
			}),
		closeTab: (id) =>
			serial(async () => {
				const index = tabs.findIndex((t) => t.id === id);
				if (index < 0) return;
				if (tabs.length === 1) {
					await tabs[0]!.page.goto("about:blank");
					return;
				}
				const [removed] = tabs.splice(index, 1);
				await removed?.page.close().catch(() => undefined);
				active = Math.min(active, tabs.length - 1);
				await current().page.bringToFront();
			}),
		switchTab: (id) =>
			serial(async () => {
				const index = tabs.findIndex((t) => t.id === id);
				if (index < 0) return;
				active = index;
				await current().page.bringToFront();
			}),
	};
}

async function driver(): Promise<BrowserDriver> {
	if (browserDriverOverride.current) {
		booted = true;
		return browserDriverOverride.current;
	}
	const bridge = bridgeFromEnv();
	if (bridge) {
		try {
			await bridgeCall(bridge, "/state");
			booted = true;
			return bridgeDriver(bridge);
		} catch {
			/* Electron isn't there (stale bridge file). Use Chromium. */
		}
	}
	return chromiumDriver();
}

function unavailable(error: string): BrowserState {
	return { ...EMPTY, error };
}

export async function browserState(): Promise<BrowserState> {
	try {
		return await (await driver()).state();
	} catch (err) {
		return unavailable(err instanceof Error ? err.message : String(err));
	}
}

export async function browserFrame(): Promise<Buffer | null> {
	try {
		return await (await driver()).screenshot();
	} catch {
		return null;
	}
}

export async function peekBrowserPage(): Promise<BrowserPageSnapshot | null> {
	if (!booted && !bridgeFromEnv() && !browserDriverOverride.current) return null;
	try {
		return await (await driver()).read();
	} catch {
		return null;
	}
}

export type BrowserCommand =
	| { op: "navigate"; url: string }
	| { op: "back" }
	| { op: "forward" }
	| { op: "reload" }
	| { op: "click"; x?: number; y?: number; selector?: string }
	| { op: "type"; text: string; selector?: string; submit?: boolean }
	| { op: "press"; key: string }
	| { op: "scroll"; dx?: number; dy?: number }
	| { op: "viewport"; width: number; height: number }
	| { op: "selection"; text: string }
	| { op: "read" }
	| { op: "newTab"; url?: string }
	| { op: "closeTab"; id: string }
	| { op: "switchTab"; id: string };

export async function browserCommand(
	body: BrowserCommand,
): Promise<{ ok: true; state: BrowserState; page?: BrowserPageSnapshot } | { ok: false; error: string }> {
	let session: BrowserDriver;
	try {
		session = await driver();
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
	try {
		switch (body.op) {
			case "navigate": {
				const url = parseBrowserUrl(body.url);
				if (!url) return { ok: false, error: "Only http(s) addresses can be opened." };
				await session.navigate(url);
				break;
			}
			case "back":
				await session.back();
				break;
			case "forward":
				await session.forward();
				break;
			case "reload":
				await session.reload();
				break;
			case "click":
				await session.click(body);
				break;
			case "type":
				await session.type(body.text, body.selector);
				if (body.submit) await session.press("Enter");
				break;
			case "press":
				await session.press(body.key);
				break;
			case "scroll":
				await session.scroll(body.dx ?? 0, body.dy ?? 480);
				break;
			case "viewport":
				await session.viewport(body.width, body.height);
				break;
			case "selection":
				await session.selection(body.text);
				break;
			case "read": {
				const page = await session.read();
				return { ok: true, state: await session.state(), page };
			}
			case "newTab": {
				const url = body.url ? parseBrowserUrl(body.url) : null;
				if (body.url && !url) return { ok: false, error: "Only http(s) addresses can be opened." };
				await session.newTab(url ?? undefined);
				break;
			}
			case "closeTab":
				await session.closeTab(body.id);
				break;
			case "switchTab":
				await session.switchTab(body.id);
				break;
			default:
				return { ok: false, error: "Unknown browser command." };
		}
		return { ok: true, state: await session.state() };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
