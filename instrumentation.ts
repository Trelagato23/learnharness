/**
 * Headless bind guard. The desktop shell and `next dev` do not set
 * LH_HEADLESS, so they are untouched. `npm run headless`, Docker, and the
 * systemd unit set it and refuse to listen on a non-loopback address
 * unless LH_PASSWORD is set — the process exits before it accepts traffic.
 */
export function register() {
	if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
	if (process.env.LH_HEADLESS !== "1") return;
	const host = process.env.HOSTNAME || "0.0.0.0";
	const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
	if (!loopback && !process.env.LH_PASSWORD) {
		console.error(
			`[learnharness] Refusing to listen on ${host} without LH_PASSWORD. Set LH_PASSWORD, or bind HOSTNAME=127.0.0.1.`,
		);
		process.exit(1);
	}
}
