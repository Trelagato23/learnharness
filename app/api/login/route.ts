import { passwordMatches, loginRequired, mintSession, cookieSecure, sessionSetCookie, sameOriginPost } from "@/src/server";

interface FailState {
	count: number;
	until: number;
}

function fails(): FailState {
	const g = globalThis as { __lhLoginFails?: FailState };
	return (g.__lhLoginFails ??= { count: 0, until: 0 });
}

const MAX_FAILS = 8;
const LOCK_MS = 30_000;

export async function GET() {
	return Response.json(
		{ required: loginRequired() },
		{ headers: { "cache-control": "no-store" } },
	);
}

export async function POST(req: Request) {
	if (!loginRequired()) {
		return Response.json({ error: "Login is not configured" }, { status: 404 });
	}
	if (!sameOriginPost(req.headers)) {
		return Response.json({ error: "Cross-origin login refused" }, { status: 403 });
	}
	const state = fails();
	const now = Date.now();
	if (state.until > now) {
		return Response.json({ error: "Too many attempts. Wait a moment and try again." }, { status: 429 });
	}
	const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
	const password = typeof body?.password === "string" ? body.password : "";
	if (!passwordMatches(password)) {
		state.count += 1;
		if (state.count >= MAX_FAILS) {
			state.count = 0;
			state.until = now + LOCK_MS;
		}
		return Response.json({ error: "Wrong password" }, { status: 401 });
	}
	state.count = 0;
	state.until = 0;
	const secure = cookieSecure(req.headers, req.url);
	const token = mintSession(now);
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
			"set-cookie": sessionSetCookie(token, secure, now),
		},
	});
}
