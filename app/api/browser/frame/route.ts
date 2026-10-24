import { browserFrame } from "@/src/server";

export const dynamic = "force-dynamic";

/** Latest JPEG of the headless (or Electron) page. The phone pane polls this. */
export async function GET() {
	const frame = await browserFrame();
	if (!frame) return new Response(null, { status: 204 });
	return new Response(new Uint8Array(frame), {
		headers: {
			"content-type": "image/jpeg",
			"cache-control": "no-store",
		},
	});
}
