/**
 * Single-user web session: password check, HMAC cookie, and the gate
 * decision the proxy applies. No server, no network.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { safeNextPath } from "../src/core/safe-next.ts";
import {
	cookieSecure,
	gateDecision,
	mintSession,
	passwordMatches,
	sessionClearCookie,
	sessionSetCookie,
	sessionValid,
	sameOriginPost,
} from "../src/server/web-session.ts";

const ORIG_PASSWORD = process.env.LH_PASSWORD;
const ORIG_SECRET = process.env.LH_SESSION_SECRET;
const ORIG_DAYS = process.env.LH_SESSION_DAYS;
const ORIG_SECURE = process.env.LH_COOKIE_SECURE;

afterEach(() => {
	restore("LH_PASSWORD", ORIG_PASSWORD);
	restore("LH_SESSION_SECRET", ORIG_SECRET);
	restore("LH_SESSION_DAYS", ORIG_DAYS);
	restore("LH_COOKIE_SECURE", ORIG_SECURE);
});

function restore(key: string, value: string | undefined) {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

describe("web session", () => {
	it("password compare is exact and does not accept a different string of the same length", () => {
		process.env.LH_PASSWORD = "correct horse";
		assert.equal(passwordMatches("correct horse"), true);
		assert.equal(passwordMatches("correct horsX"), false);
		assert.equal(passwordMatches(""), false);
	});

	it("mints a cookie that verifies until expiry, and rejects tampering", () => {
		process.env.LH_PASSWORD = "pw";
		const now = 1_700_000_000_000;
		const token = mintSession(now);
		assert.equal(sessionValid(token, now + 1000), true);
		assert.equal(sessionValid(token, now + 31 * 86_400_000), false);
		const [exp, sig] = token.split(".");
		assert.equal(sessionValid(`${exp}.${sig}x`, now + 1000), false);
		assert.equal(sessionValid(`${Number(exp) + 1}.${sig}`, now + 1000), false);
		assert.equal(sessionValid(undefined, now), false);
	});

	it("a dedicated session secret is what the HMAC uses", () => {
		process.env.LH_PASSWORD = "pw";
		process.env.LH_SESSION_SECRET = "secret-a";
		const token = mintSession(1_700_000_000_000);
		process.env.LH_SESSION_SECRET = "secret-b";
		assert.equal(sessionValid(token, 1_700_000_000_000), false);
	});

	it("gate: off when no password; pages redirect; APIs 401; login stays open", () => {
		delete process.env.LH_PASSWORD;
		assert.equal(gateDecision("/api/chats", undefined), "allow");
		process.env.LH_PASSWORD = "pw";
		assert.equal(gateDecision("/login", undefined), "allow");
		assert.equal(gateDecision("/api/login", undefined), "allow");
		assert.equal(gateDecision("/api/chats", undefined), "unauthorized");
		assert.equal(gateDecision("/chat/abc", undefined), "login");
		assert.equal(gateDecision("/", undefined), "login");
		const token = mintSession();
		assert.equal(gateDecision("/api/chats", token), "allow");
		assert.equal(gateDecision("/", token), "allow");
	});

	it("cookie flags: HttpOnly, SameSite=Lax, Secure only when the request is https", () => {
		process.env.LH_PASSWORD = "pw";
		const token = mintSession(1_700_000_000_000);
		const http = sessionSetCookie(token, false, 1_700_000_000_000);
		assert.match(http, /HttpOnly/);
		assert.match(http, /SameSite=Lax/);
		assert.doesNotMatch(http, /Secure/);
		assert.match(sessionSetCookie(token, true, 1_700_000_000_000), /Secure/);
		assert.match(sessionClearCookie(true), /Max-Age=0/);
		assert.equal(cookieSecure(new Headers({ "x-forwarded-proto": "https" }), "http://localhost/"), true);
		assert.equal(cookieSecure(new Headers(), "http://10.0.0.5:3000/"), false);
		process.env.LH_COOKIE_SECURE = "1";
		assert.equal(cookieSecure(new Headers(), "http://10.0.0.5:3000/"), true);
	});

	it("same-origin POST allows a missing Origin and refuses a foreign one", () => {
		assert.equal(sameOriginPost(new Headers({ host: "lh.local:3000" })), true);
		assert.equal(
			sameOriginPost(new Headers({ host: "lh.local:3000", origin: "http://lh.local:3000" })),
			true,
		);
		assert.equal(
			sameOriginPost(new Headers({ host: "lh.local:3000", origin: "http://evil.example" })),
			false,
		);
	});

	it("safe next paths stay on this origin", () => {
		assert.equal(safeNextPath("/chat/abc?x=1"), "/chat/abc?x=1");
		assert.equal(safeNextPath("/"), "/");
		assert.equal(safeNextPath(null), "/");
		assert.equal(safeNextPath("//evil.example"), "/");
		assert.equal(safeNextPath("https://evil.example"), "/");
		assert.equal(safeNextPath("/\\evil"), "/");
	});
});
