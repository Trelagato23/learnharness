/**
 * Single-user web session (homelab). Off unless LH_PASSWORD is set, so the
 * Electron shell and local dev stay unchanged. The cookie is an HMAC of an
 * expiry instant — there is no server-side session store. Changing
 * LH_PASSWORD (or LH_SESSION_SECRET, when set) invalidates every cookie.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "lh_session";

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export function loginRequired(): boolean {
	return typeof process.env.LH_PASSWORD === "string" && process.env.LH_PASSWORD.length > 0;
}

function macSecret(): string {
	const dedicated = process.env.LH_SESSION_SECRET;
	if (typeof dedicated === "string" && dedicated.length > 0) return dedicated;
	return process.env.LH_PASSWORD ?? "";
}

function ttlMs(): number {
	const days = Number(process.env.LH_SESSION_DAYS);
	if (!Number.isFinite(days) || days <= 0) return DEFAULT_TTL_MS;
	return Math.min(MAX_TTL_MS, Math.floor(days * 86_400_000));
}

/** Constant-time check of the submitted password against LH_PASSWORD. */
export function passwordMatches(given: string): boolean {
	const expected = process.env.LH_PASSWORD ?? "";
	if (!expected || typeof given !== "string") return false;
	const a = createHash("sha256").update(expected, "utf8").digest();
	const b = createHash("sha256").update(given, "utf8").digest();
	return timingSafeEqual(a, b);
}

export function mintSession(now = Date.now()): string {
	const exp = String(now + ttlMs());
	const sig = createHmac("sha256", macSecret()).update(exp).digest("base64url");
	return `${exp}.${sig}`;
}

export function sessionValid(token: string | undefined | null, now = Date.now()): boolean {
	if (!loginRequired() || !token) return false;
	const dot = token.indexOf(".");
	if (dot <= 0) return false;
	const exp = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	if (!/^\d+$/.test(exp)) return false;
	const expMs = Number(exp);
	if (!Number.isFinite(expMs) || expMs <= now) return false;
	const expected = createHmac("sha256", macSecret()).update(exp).digest("base64url");
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/** Paths that must answer before a session exists (the login form, its
 *  API, and the PWA shell the browser fetches while logged out). */
export function isPublicPath(pathname: string): boolean {
	if (pathname === "/login" || pathname === "/api/login" || pathname === "/api/logout") return true;
	if (pathname === "/manifest.webmanifest" || pathname === "/sw.js") return true;
	if (pathname.startsWith("/icons/") || pathname.startsWith("/fonts/") || pathname.startsWith("/worklets/")) return true;
	return false;
}

export type GateDecision = "allow" | "login" | "unauthorized";

export function gateDecision(pathname: string, cookie: string | undefined | null, now = Date.now()): GateDecision {
	if (!loginRequired()) return "allow";
	if (isPublicPath(pathname)) return "allow";
	if (sessionValid(cookie, now)) return "allow";
	if (pathname.startsWith("/api/")) return "unauthorized";
	return "login";
}

export function cookieSecure(headers: Headers, url: string): boolean {
	const forced = process.env.LH_COOKIE_SECURE;
	if (forced === "1" || forced === "true") return true;
	if (forced === "0" || forced === "false") return false;
	const forwarded = headers.get("x-forwarded-proto");
	if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}

export function sessionSetCookie(token: string, secure: boolean, now = Date.now()): string {
	const exp = Number(token.slice(0, token.indexOf(".")));
	const maxAge = Math.max(0, Math.floor((exp - now) / 1000));
	const parts = [
		`${SESSION_COOKIE}=${token}`,
		"HttpOnly",
		"Path=/",
		"SameSite=Lax",
		`Max-Age=${maxAge}`,
	];
	if (secure) parts.push("Secure");
	return parts.join("; ");
}

export function sessionClearCookie(secure: boolean): string {
	const parts = [`${SESSION_COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
	if (secure) parts.push("Secure");
	return parts.join("; ");
}

/** Reject a cross-site login/logout POST. Missing Origin is allowed: some
 *  same-origin clients (and curl) omit it; a present Origin must match Host. */
export function sameOriginPost(headers: Headers): boolean {
	const origin = headers.get("origin");
	if (!origin) return true;
	const host = headers.get("host");
	if (!host) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}
