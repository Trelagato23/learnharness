import { cookieSecure, sameOriginPost, sessionClearCookie } from "@/src/server";

export async function POST(req: Request) {
	if (!sameOriginPost(req.headers)) {
		return Response.json({ error: "Cross-origin logout refused" }, { status: 403 });
	}
	const secure = cookieSecure(req.headers, req.url);
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
			"set-cookie": sessionClearCookie(secure),
		},
	});
}
