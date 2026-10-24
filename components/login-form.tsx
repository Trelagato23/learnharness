"use client";

import { useState } from "react";
import { safeNextPath } from "@/src/core";

export function LoginForm({ nextPath }: { nextPath: string }) {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	return (
		<form
			className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-lg"
			onSubmit={(e) => {
				e.preventDefault();
				if (busy) return;
				setBusy(true);
				setError(null);
				void fetch("/api/login", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ password }),
				})
					.then(async (res) => {
						if (!res.ok) {
							const body = (await res.json().catch(() => null)) as { error?: string } | null;
							setError(body?.error ?? "Could not sign in");
							setBusy(false);
							return;
						}
						window.location.assign(safeNextPath(nextPath));
					})
					.catch(() => {
						setError("Could not reach the server");
						setBusy(false);
					});
			}}
		>
			<h1 className="font-title text-3xl tracking-tight">LearnHarness</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				This copy is on your network. Sign in with the password set on the server.
			</p>
			<label className="mt-6 block text-xs uppercase tracking-wider text-muted-foreground" htmlFor="lh-password">
				Password
			</label>
			<input
				id="lh-password"
				name="password"
				type="password"
				autoComplete="current-password"
				autoFocus
				required
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				className="mt-2 h-12 w-full rounded-lg border bg-background px-3 text-base outline-none"
			/>
			{error && (
				<p role="alert" className="mt-3 text-sm text-red-400">
					{error}
				</p>
			)}
			<button
				type="submit"
				disabled={busy || password.length === 0}
				className="mt-4 flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base text-primary-foreground disabled:opacity-40"
			>
				{busy ? "Signing in…" : "Sign in"}
			</button>
		</form>
	);
}
