/**
 * serve-headless.mjs — run the standalone Next server without Electron.
 *
 * Binds HOSTNAME (default 0.0.0.0) and PORT (default 3000). LH_DATA_DIR
 * relocates chats, the graph, and settings (default: <repo>/data).
 * LH_AUTH_FILE defaults to <LH_DATA_DIR>/auth.json.
 *
 * A non-loopback bind requires LH_PASSWORD. The child is started with
 * LH_HEADLESS=1 so instrumentation.ts repeats that check inside the server
 * and exits before it accepts traffic if the password is missing.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVER = path.join(ROOT, ".next", "standalone", "server.js");

const host = process.env.HOSTNAME || "0.0.0.0";
const port = process.env.PORT || "3000";
const dataDir = path.resolve(process.env.LH_DATA_DIR || path.join(ROOT, "data"));
const authFile = process.env.LH_AUTH_FILE
	? path.resolve(process.env.LH_AUTH_FILE)
	: path.join(dataDir, "auth.json");
const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";

if (!fs.existsSync(SERVER)) {
	console.error("[headless] .next/standalone/server.js is missing.");
	console.error("           Build first: npm run build && node scripts/build-server.mjs");
	process.exit(1);
}

if (!loopback && !process.env.LH_PASSWORD) {
	console.error(`[headless] Refusing to listen on ${host} without LH_PASSWORD.`);
	console.error("           Set LH_PASSWORD, or bind loopback: HOSTNAME=127.0.0.1 npm run headless");
	process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });

const child = spawn(process.execPath, [SERVER], {
	cwd: path.dirname(SERVER),
	stdio: "inherit",
	env: {
		...process.env,
		NODE_ENV: "production",
		HOSTNAME: host,
		PORT: port,
		LH_DATA_DIR: dataDir,
		LH_AUTH_FILE: authFile,
		LH_HEADLESS: "1",
	},
});

const stop = (signal) => {
	if (!child.killed) child.kill(signal);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("exit", (code, signal) => {
	if (signal) process.exit(1);
	process.exit(code ?? 0);
});
