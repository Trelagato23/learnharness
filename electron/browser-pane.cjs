/**
 * The desktop browser pane: a WebContentsView laid over the window where
 * the renderer says the page area is. A loopback HTTP bridge lets the
 * Next server (and therefore the agent tools) drive the same view.
 *
 * The bridge token never leaves the machine. The phone does not use this
 * file — it uses the server's own Chromium.
 */
const { BrowserWindow, WebContentsView, ipcMain } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const BRIDGE_FILE = path.join(os.tmpdir(), "learnharness-browser-bridge.json");
const KEYS = {
	Enter: "Return",
	Backspace: "Backspace",
	Tab: "Tab",
	Escape: "Escape",
	ArrowUp: "Up",
	ArrowDown: "Down",
	ArrowLeft: "Left",
	ArrowRight: "Right",
};

function startBrowserPane() {
	const token = crypto.randomBytes(24).toString("hex");
	const tabs = [];
	let active = 0;
	let win = null;
	let bounds = null;
	let pinnedSelection = "";
	let seq = 1;

	function activeTab() {
		return tabs[active] ?? null;
	}

	function layout() {
		if (!win) return;
		const zoom = win.webContents.getZoomFactor() || 1;
		for (let i = 0; i < tabs.length; i++) {
			const view = tabs[i].view;
			if (!bounds || i !== active) {
				view.setVisible(false);
				view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
				continue;
			}
			view.setVisible(true);
			view.setBounds({
				x: Math.round(bounds.x * zoom),
				y: Math.round(bounds.y * zoom),
				width: Math.max(0, Math.round(bounds.width * zoom)),
				height: Math.max(0, Math.round(bounds.height * zoom)),
			});
		}
	}

	function attachView(tab) {
		if (!win || tab.attached) return;
		win.contentView.addChildView(tab.view);
		tab.attached = true;
	}

	function wire(view) {
		view.webContents.setWindowOpenHandler(({ url }) => {
			if (/^https?:/i.test(url)) createTab(url);
			return { action: "deny" };
		});
		view.webContents.on("will-navigate", (event, url) => {
			if (!/^https?:/i.test(url) && url !== "about:blank") event.preventDefault();
		});
	}

	function createTab(initialUrl) {
		const view = new WebContentsView({
			webPreferences: {
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				partition: "persist:learnharness-browser",
			},
		});
		const tab = { id: `tab_${seq++}`, view, attached: false };
		wire(view);
		tabs.push(tab);
		attachView(tab);
		const target = /^https?:/i.test(initialUrl || "") ? initialUrl : "about:blank";
		void view.webContents.loadURL(target);
		active = tabs.length - 1;
		layout();
		return tab;
	}

	function ensureTab() {
		if (tabs.length === 0) createTab();
		return activeTab();
	}

	ipcMain.on("lh:browser-bounds", (event, rect) => {
		const sender = BrowserWindow.fromWebContents(event.sender);
		if (sender) win = sender;
		bounds = rect && rect.width > 0 && rect.height > 0 ? rect : null;
		for (const tab of tabs) attachView(tab);
		if (bounds) ensureTab();
		layout();
	});

	async function describe(tab) {
		const wc = tab.view.webContents;
		let selection = "";
		try {
			selection = await wc.executeJavaScript("window.getSelection() ? window.getSelection().toString() : ''", true);
		} catch {
			selection = "";
		}
		const nav = wc.navigationHistory;
		return {
			id: tab.id,
			url: wc.getURL() || "about:blank",
			title: wc.getTitle() || "",
			canGoBack: nav ? nav.canGoBack() : wc.canGoBack(),
			canGoForward: nav ? nav.canGoForward() : wc.canGoForward(),
			selection: String(selection || pinnedSelection).slice(0, 8000),
		};
	}

	async function state() {
		const tab = activeTab();
		if (!tab) {
			return {
				mode: "electron",
				url: "about:blank",
				title: "",
				canGoBack: false,
				canGoForward: false,
				selection: pinnedSelection,
				tabs: [],
			};
		}
		const current = await describe(tab);
		const listed = [];
		for (let i = 0; i < tabs.length; i++) {
			const info = i === active ? current : await describe(tabs[i]);
			listed.push({ id: tabs[i].id, url: info.url, title: info.title || info.url, active: i === active });
		}
		return {
			mode: "electron",
			url: current.url,
			title: current.title,
			canGoBack: current.canGoBack,
			canGoForward: current.canGoForward,
			selection: current.selection,
			tabs: listed,
		};
	}

	function httpUrl(raw) {
		try {
			const url = new URL(raw);
			if (url.protocol !== "http:" && url.protocol !== "https:") return null;
			return url.toString();
		} catch {
			return null;
		}
	}

	async function command(body) {
		const tab = ensureTab();
		const wc = tab.view.webContents;
		switch (body.op) {
			case "navigate": {
				const url = httpUrl(body.url);
				if (!url) throw new Error("Only http(s) addresses can be opened.");
				pinnedSelection = "";
				await wc.loadURL(url);
				break;
			}
			case "back":
				if (wc.navigationHistory?.canGoBack()) wc.navigationHistory.goBack();
				else if (wc.canGoBack()) wc.goBack();
				break;
			case "forward":
				if (wc.navigationHistory?.canGoForward()) wc.navigationHistory.goForward();
				else if (wc.canGoForward()) wc.goForward();
				break;
			case "reload":
				wc.reload();
				break;
			case "click": {
				if (typeof body.selector === "string" && body.selector) {
					const sel = JSON.stringify(body.selector);
					const found = await wc.executeJavaScript(
						`(() => { const el = document.querySelector(${sel}); if (!el) return false; el.click(); return true; })()`,
						true,
					);
					if (!found) throw new Error(`No element matches ${body.selector}`);
					break;
				}
				const x = Number(body.x);
				const y = Number(body.y);
				if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("click needs a selector or both x and y");
				wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
				wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
				break;
			}
			case "type": {
				if (typeof body.selector === "string" && body.selector) {
					const sel = JSON.stringify(body.selector);
					const found = await wc.executeJavaScript(
						`(() => { const el = document.querySelector(${sel}); if (!el) return false; el.focus(); return true; })()`,
						true,
					);
					if (!found) throw new Error(`No element matches ${body.selector}`);
				}
				wc.focus();
				await wc.insertText(String(body.text ?? ""));
				break;
			}
			case "press": {
				const key = KEYS[body.key] || body.key;
				wc.sendInputEvent({ type: "keyDown", keyCode: key });
				wc.sendInputEvent({ type: "keyUp", keyCode: key });
				break;
			}
			case "scroll":
				wc.sendInputEvent({
					type: "mouseWheel",
					x: 20,
					y: 20,
					deltaX: Number(body.dx) || 0,
					deltaY: Number(body.dy) || 480,
				});
				break;
			case "viewport":
				break;
			case "selection":
				pinnedSelection = String(body.text ?? "").slice(0, 8000);
				break;
			case "newTab": {
				const url = body.url ? httpUrl(body.url) : null;
				if (body.url && !url) throw new Error("Only http(s) addresses can be opened.");
				createTab(url || undefined);
				break;
			}
			case "closeTab": {
				const index = tabs.findIndex((t) => t.id === body.id);
				if (index < 0) break;
				if (tabs.length === 1) {
					await wc.loadURL("about:blank");
					break;
				}
				const [removed] = tabs.splice(index, 1);
				if (win && removed.attached) win.contentView.removeChildView(removed.view);
				active = Math.min(active, tabs.length - 1);
				layout();
				break;
			}
			case "switchTab": {
				const index = tabs.findIndex((t) => t.id === body.id);
				if (index >= 0) active = index;
				layout();
				break;
			}
			default:
				throw new Error("Unknown browser command.");
		}
		return state();
	}

	async function read() {
		const tab = ensureTab();
		const info = await describe(tab);
		let html = "";
		try {
			html = await tab.view.webContents.executeJavaScript("document.documentElement.outerHTML", true);
		} catch {
			html = "";
		}
		if (html.length > 1_500_000) html = html.slice(0, 1_500_000);
		return { url: info.url, title: info.title, selection: info.selection, html };
	}

	function readBody(req) {
		return new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on("data", (chunk) => {
				size += chunk.length;
				if (size > 1_000_000) {
					reject(new Error("body too large"));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}

	const server = http.createServer(async (req, res) => {
		if (req.headers["x-lh-browser-token"] !== token) {
			res.writeHead(403, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "forbidden" }));
			return;
		}
		try {
			const url = new URL(req.url || "/", "http://127.0.0.1");
			if (req.method === "GET" && url.pathname === "/state") {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify(await state()));
				return;
			}
			if (req.method === "GET" && url.pathname === "/read") {
				const page = await read();
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify(page));
				return;
			}
			if (req.method === "GET" && url.pathname === "/frame") {
				const tab = ensureTab();
				const image = await tab.view.webContents.capturePage();
				const jpeg = image.toJPEG(55);
				res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
				res.end(jpeg);
				return;
			}
			if (req.method === "POST" && url.pathname === "/command") {
				const raw = await readBody(req);
				const body = raw ? JSON.parse(raw) : {};
				const next = await command(body);
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify(next));
				return;
			}
			res.writeHead(404);
			res.end();
		} catch (err) {
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
		}
	});

	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const port = server.address().port;
			const base = `http://127.0.0.1:${port}`;
			fs.writeFileSync(BRIDGE_FILE, JSON.stringify({ base, token }), { mode: 0o600 });
			resolve({
				base,
				token,
				attach(window) {
					win = window;
					for (const tab of tabs) attachView(tab);
					layout();
				},
				stop() {
					server.close();
					try {
						fs.unlinkSync(BRIDGE_FILE);
					} catch {
						/* already gone */
					}
				},
			});
		});
	});
}

module.exports = { startBrowserPane, BRIDGE_FILE };
