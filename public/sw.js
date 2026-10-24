/**
 * LearnHarness shell cache. Static assets are cache-first. Navigations are
 * network-first so a login redirect is never served stale. /api is never
 * intercepted — streamed turns and session data stay on the network.
 */
const CACHE = "lh-shell-v1";
const PRECACHE = ["/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
			.catch(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const req = event.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith("/api/")) return;
	if (req.headers.get("accept")?.includes("text/event-stream")) return;

	const shell =
		url.pathname.startsWith("/_next/static/") ||
		url.pathname.startsWith("/icons/") ||
		url.pathname.startsWith("/fonts/") ||
		url.pathname.startsWith("/worklets/");

	if (shell) {
		event.respondWith(
			caches.open(CACHE).then(async (cache) => {
				const hit = await cache.match(req);
				if (hit) return hit;
				const res = await fetch(req);
				if (res.ok) await cache.put(req, res.clone());
				return res;
			}),
		);
		return;
	}

	if (req.mode === "navigate") {
		event.respondWith(
			fetch(req)
				.then((res) => {
					const copy = res.clone();
					void caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
					return res;
				})
				.catch(async () => {
					const cache = await caches.open(CACHE);
					return (await cache.match(req)) || (await cache.match("/")) || new Response("Offline", { status: 503 });
				}),
		);
	}
});
