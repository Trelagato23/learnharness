/**
 * Where to send the browser after a successful login. Only same-origin
 * paths: a value that is not a single-slash relative path becomes "/".
 */
export function safeNextPath(raw: string | null | undefined): string {
	if (!raw) return "/";
	if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.includes("://")) return "/";
	return raw;
}
