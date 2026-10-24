"use client";

import { useEffect } from "react";

/** Register the shell-caching service worker in production only. Dev keeps
 *  a clean network so HMR is not fighting a stale cache. */
export function PwaRegister() {
	useEffect(() => {
		if (process.env.NODE_ENV !== "production") return;
		if (!("serviceWorker" in navigator)) return;
		void navigator.serviceWorker.register("/sw.js").catch(() => {});
	}, []);
	return null;
}
