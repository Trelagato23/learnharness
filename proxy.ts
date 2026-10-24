import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "./src/core/safe-next.ts";
import { SESSION_COOKIE, gateDecision } from "./src/server/web-session.ts";

/**
 * Web login gate. No-op unless LH_PASSWORD is set (desktop Electron and
 * `next dev` do not set it). API calls get 401; page navigations redirect
 * to /login. Static assets are excluded by the matcher so the login page
 * and the PWA shell can load logged-out.
 */
export function proxy(request: NextRequest) {
	const { pathname, search } = request.nextUrl;
	const decision = gateDecision(pathname, request.cookies.get(SESSION_COOKIE)?.value);
	if (decision === "allow") return NextResponse.next();
	if (decision === "unauthorized") {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const url = request.nextUrl.clone();
	url.pathname = "/login";
	url.search = "";
	const next = safeNextPath(pathname + search);
	if (next !== "/") url.searchParams.set("next", next);
	return NextResponse.redirect(url);
}

export const config = {
	matcher: [
		// Everything except hashed build assets and public files the login
		// page / installed PWA need before a session cookie exists.
		"/((?!_next/static|_next/image|favicon.ico|icons/|fonts/|worklets/|sw\\.js|.*\\.(?:png|ico|svg|webp|txt|woff2?)$).*)",
	],
};
