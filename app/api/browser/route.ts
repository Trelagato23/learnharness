import { browserCommand, browserState, type BrowserCommand } from "@/src/server";

export const dynamic = "force-dynamic";

const OPS = new Set([
	"navigate",
	"back",
	"forward",
	"reload",
	"click",
	"type",
	"press",
	"scroll",
	"viewport",
	"selection",
	"read",
	"newTab",
	"closeTab",
	"switchTab",
]);

export async function GET() {
	return Response.json(await browserState());
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as BrowserCommand | null;
	if (!body || typeof body !== "object" || !OPS.has((body as { op?: string }).op ?? "")) {
		return Response.json({ error: "Unknown browser command." }, { status: 400 });
	}
	const result = await browserCommand(body);
	if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
	return Response.json(result);
}
