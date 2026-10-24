"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Chat } from "@/components/chat";
import type { LhMessage } from "@/src/core";
import { viewportPoint } from "@/src/core";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	GlobeIcon,
	MessageSquareIcon,
	PlusIcon,
	RotateCwIcon,
	TextIcon,
	XIcon,
} from "lucide-react";

interface TabState {
	id: string;
	url: string;
	title: string;
	active: boolean;
}

interface BrowserState {
	mode?: "electron" | "chromium" | "unavailable";
	error?: string;
	url: string;
	title: string;
	canGoBack: boolean;
	canGoForward: boolean;
	selection: string;
	tabs: TabState[];
}

interface ChatListItem {
	id: string;
	title: string;
	updatedAt?: string;
	kind?: "teach" | "practice";
}

interface LoadedChat {
	id: string;
	title: string;
	kind?: "teach" | "practice";
	messages: LhMessage[];
	turnInFlight?: boolean;
	compacting?: boolean;
}

const KEYS = new Set(["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

async function command(body: Record<string, unknown>): Promise<{ state?: BrowserState; page?: { markdown: string }; error?: string }> {
	const res = await fetch("/api/browser", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = (await res.json().catch(() => null)) as { state?: BrowserState; page?: { markdown: string }; error?: string } | null;
	if (!res.ok) return { error: data?.error || `HTTP ${res.status}` };
	return data ?? {};
}

/**
 * Browser in the main area, the existing chat in a side panel.
 * Under 640px the two swap with the toggle (and a horizontal swipe)
 * instead of sitting beside each other. Electron paints a real
 * WebContentsView into the page rectangle; the phone polls JPEG frames.
 */
export function BrowserWorkspace({ initialConfigured }: { initialConfigured: boolean }) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const addressRef = useRef<HTMLInputElement>(null);
	const [state, setState] = useState<BrowserState | null>(null);
	const [address, setAddress] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [frame, setFrame] = useState<string | null>(null);
	const [reader, setReader] = useState<string | null>(null);
	const [phone, setPhone] = useState(false);
	const [pane, setPane] = useState<"browser" | "chat">("browser");
	const [chatOpen, setChatOpen] = useState(true);
	const [chatWidth, setChatWidth] = useState(420);
	const [chats, setChats] = useState<ChatListItem[]>([]);
	const [chat, setChat] = useState<LoadedChat | null>(null);
	const electron = typeof window !== "undefined" && !!window.lh?.browser;
	const showBrowser = !phone || pane === "browser";
	const showChat = phone ? pane === "chat" : chatOpen;

	useEffect(() => {
		const mq = window.matchMedia("(max-width: 639px)");
		const apply = () => setPhone(mq.matches);
		apply();
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, []);

	useEffect(() => {
		const stored = window.localStorage.getItem("lh-browser-chat-width");
		const width = stored ? Number(stored) : NaN;
		if (Number.isFinite(width)) setChatWidth(Math.min(720, Math.max(280, width)));
		if (window.localStorage.getItem("lh-browser-chat-open") === "0") setChatOpen(false);
	}, []);

	const applyState = useCallback((next: BrowserState) => {
		setState(next);
		setError(next.error ?? null);
		if (document.activeElement === addressRef.current) return;
		const active = next.tabs.find((t) => t.active);
		setAddress(active?.url && active.url !== "about:blank" ? active.url : next.url === "about:blank" ? "" : next.url);
	}, []);

	const refresh = useCallback(async () => {
		const res = await fetch("/api/browser", { cache: "no-store" });
		if (!res.ok) return;
		applyState((await res.json()) as BrowserState);
	}, [applyState]);

	useEffect(() => {
		void refresh();
		const id = window.setInterval(() => void refresh(), 1200);
		return () => window.clearInterval(id);
	}, [refresh]);

	useEffect(() => {
		if (electron || !showBrowser) return;
		let stop = false;
		let current: string | null = null;
		let timer = 0;
		const tick = async () => {
			if (stop) return;
			try {
				const res = await fetch("/api/browser/frame", { cache: "no-store" });
				if (res.ok && res.status !== 204) {
					const blob = await res.blob();
					const next = URL.createObjectURL(blob);
					if (current) URL.revokeObjectURL(current);
					current = next;
					if (!stop) setFrame(next);
				}
			} catch {
				/* the next tick retries */
			}
			if (!stop) timer = window.setTimeout(() => void tick(), 450);
		};
		void tick();
		return () => {
			stop = true;
			window.clearTimeout(timer);
			if (current) URL.revokeObjectURL(current);
		};
	}, [electron, showBrowser]);

	useEffect(() => {
		const el = viewportRef.current;
		const bridge = window.lh?.browser;
		if (!el) return;
		if (bridge) {
			if (!showBrowser) {
				bridge.setBounds(null);
				return;
			}
			const post = () => {
				const rect = el.getBoundingClientRect();
				bridge.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
			};
			post();
			const observer = new ResizeObserver(post);
			observer.observe(el);
			window.addEventListener("resize", post);
			window.addEventListener("scroll", post, true);
			return () => {
				observer.disconnect();
				window.removeEventListener("resize", post);
				window.removeEventListener("scroll", post, true);
				bridge.setBounds(null);
			};
		}
		if (!showBrowser) return;
		const post = () => {
			const rect = el.getBoundingClientRect();
			if (rect.width < 50 || rect.height < 50) return;
			void command({ op: "viewport", width: Math.round(rect.width), height: Math.round(rect.height) });
		};
		post();
		const observer = new ResizeObserver(post);
		observer.observe(el);
		return () => observer.disconnect();
	}, [electron, showBrowser, phone, pane, chatOpen, chatWidth]);

	useEffect(() => {
		let stop = false;
		void fetch("/api/chats")
			.then((res) => res.json())
			.then((data: { chats?: ChatListItem[] }) => {
				if (stop) return;
				const list = data.chats ?? [];
				setChats(list);
				if (list[0]) void loadChat(list[0].id);
			})
			.catch(() => undefined);
		return () => {
			stop = true;
		};
	}, []);

	const loadChat = async (id: string) => {
		const res = await fetch(`/api/chats/${id}`);
		if (!res.ok) return;
		setChat((await res.json()) as LoadedChat);
	};

	const run = async (body: Record<string, unknown>) => {
		const result = await command(body);
		if (result.error) setError(result.error);
		else if (result.state) applyState(result.state);
		else await refresh();
		return result;
	};

	const go = (event: FormEvent) => {
		event.preventDefault();
		void run({ op: "navigate", url: address });
	};

	const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
		if (electron) return;
		event.preventDefault();
		void command({ op: "scroll", dx: event.deltaX, dy: event.deltaY });
	};

	const quoteSelection = () => {
		const text = window.getSelection()?.toString().trim() || state?.selection.trim() || "";
		if (!text) return;
		void command({ op: "selection", text });
		setState((cur) => (cur ? { ...cur, selection: text } : cur));
	};

	const touch = useRef<{ x: number; y: number } | null>(null);

	return (
		<div className="flex h-dvh min-h-0 flex-col" data-testid="browser-workspace">
			<div
				className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5"
				onTouchStart={(event) => {
					const t = event.changedTouches[0];
					if (t) touch.current = { x: t.clientX, y: t.clientY };
				}}
				onTouchEnd={(event) => {
					if (!phone || !touch.current) return;
					const t = event.changedTouches[0];
					if (!t) return;
					const dx = t.clientX - touch.current.x;
					const dy = t.clientY - touch.current.y;
					touch.current = null;
					if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
					setPane(dx < 0 ? "chat" : "browser");
				}}
			>
				<button type="button" aria-label="Back" disabled={!state?.canGoBack} className="flex size-11 items-center justify-center rounded-md disabled:opacity-30" onClick={() => void run({ op: "back" })}>
					<ArrowLeftIcon className="size-4" />
				</button>
				<button type="button" aria-label="Forward" disabled={!state?.canGoForward} className="flex size-11 items-center justify-center rounded-md disabled:opacity-30" onClick={() => void run({ op: "forward" })}>
					<ArrowRightIcon className="size-4" />
				</button>
				<button type="button" aria-label="Reload" className="flex size-11 items-center justify-center rounded-md" onClick={() => void run({ op: "reload" })}>
					<RotateCwIcon className="size-4" />
				</button>
				<form onSubmit={go} className="order-first w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
					<input
						ref={addressRef}
						aria-label="Address"
						data-testid="browser-address"
						value={address}
						onChange={(event) => setAddress(event.target.value)}
						placeholder="Search or enter an address"
						className="h-11 w-full rounded-lg border bg-background px-3 text-base outline-none"
						spellCheck={false}
					/>
				</form>
				<button
					type="button"
					aria-label="Page text"
					className="flex size-11 items-center justify-center rounded-md"
					onClick={() => {
						if (reader !== null) {
							setReader(null);
							return;
						}
						void run({ op: "read" }).then((result) => setReader(result.page?.markdown ?? ""));
					}}
				>
					<TextIcon className="size-4" />
				</button>
				<button
					type="button"
					data-testid="browser-chat-toggle"
					aria-pressed={showChat}
					className="flex h-11 items-center gap-1.5 rounded-md px-3 text-sm sm:px-2"
					onClick={() => {
						if (phone) {
							setPane(pane === "chat" ? "browser" : "chat");
							return;
						}
						setChatOpen((open) => {
							window.localStorage.setItem("lh-browser-chat-open", open ? "0" : "1");
							return !open;
						});
					}}
				>
					{phone && pane === "browser" ? <MessageSquareIcon className="size-4" /> : <GlobeIcon className="size-4 sm:hidden" />}
					<span className="hidden sm:inline">{chatOpen ? "Hide chat" : "Show chat"}</span>
					<span className="sm:hidden">{phone && pane === "chat" ? "Browser" : "Chat"}</span>
				</button>
			</div>
			<div className="flex gap-1 overflow-x-auto border-b px-2 py-1">
				{(state?.tabs ?? []).map((tab) => (
					<div key={tab.id} className={`flex min-w-0 items-center rounded-md ${tab.active ? "bg-accent" : ""}`}>
						<button type="button" className="max-w-40 truncate px-2 py-2 text-left text-xs" onClick={() => void run({ op: "switchTab", id: tab.id })}>
							{tab.title || tab.url || "New tab"}
						</button>
						<button type="button" aria-label={`Close ${tab.title || "tab"}`} className="flex size-9 items-center justify-center" onClick={() => void run({ op: "closeTab", id: tab.id })}>
							<XIcon className="size-3" />
						</button>
					</div>
				))}
				<button type="button" aria-label="New tab" className="flex size-9 shrink-0 items-center justify-center rounded-md" onClick={() => void run({ op: "newTab" })}>
					<PlusIcon className="size-4" />
				</button>
			</div>
			{error && <p className="border-b px-3 py-1 text-xs text-red-400">{error}</p>}
			{state?.selection ? (
				<p className="truncate border-b px-3 py-1 text-xs text-muted-foreground">Selection: {state.selection}</p>
			) : null}
			<div className="flex min-h-0 flex-1">
				<div className={showBrowser ? "flex min-w-0 flex-1 flex-col" : "hidden"} data-testid="browser-pane">
					<div
						ref={viewportRef}
						tabIndex={0}
						className="relative min-h-0 flex-1 overflow-hidden bg-neutral-950 outline-none"
						onWheel={onWheel}
						onPointerDown={(event) => {
							if (electron) return;
							const rect = event.currentTarget.getBoundingClientRect();
							const point = viewportPoint(event.clientX, event.clientY, rect);
							if (!point) return;
							event.currentTarget.focus();
							void command({ op: "click", x: point.x, y: point.y });
						}}
						onKeyDown={(event) => {
							if (electron) return;
							if (event.metaKey || event.ctrlKey || event.altKey) return;
							if (event.key.length === 1) {
								event.preventDefault();
								void command({ op: "type", text: event.key });
							} else if (KEYS.has(event.key)) {
								event.preventDefault();
								void command({ op: "press", key: event.key });
							}
						}}
					>
						{electron ? (
							<div className="pointer-events-none absolute inset-0" data-testid="browser-native-hole" />
						) : frame ? (
							// A blob URL of the live JPEG stream. next/image cannot host that.
							// eslint-disable-next-line @next/next/no-img-element
							<img src={frame} alt="" className="h-full w-full object-fill" draggable={false} />
						) : (
							<div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
								{error || "The page will show here. Enter an address, or ask the agent to open one."}
							</div>
						)}
						{reader !== null && (
							<div className="absolute inset-0 overflow-auto bg-background p-4" data-testid="browser-reader" onMouseUp={quoteSelection}>
								<p className="mb-3 text-xs text-muted-foreground">Highlight text, then ask about it in the chat. The next message includes the selection.</p>
								<pre className="whitespace-pre-wrap font-sans text-sm">{reader || "(no readable text)"}</pre>
							</div>
						)}
					</div>
				</div>
				{showChat && !phone && (
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize chat"
						className="w-1.5 shrink-0 cursor-col-resize bg-border"
						onPointerDown={(event) => {
							const startX = event.clientX;
							const startW = chatWidth;
							const move = (ev: PointerEvent) => {
								const next = Math.min(720, Math.max(280, startW + (startX - ev.clientX)));
								setChatWidth(next);
							};
							const up = () => {
								window.removeEventListener("pointermove", move);
								window.removeEventListener("pointerup", up);
								setChatWidth((width) => {
									window.localStorage.setItem("lh-browser-chat-width", String(width));
									return width;
								});
							};
							window.addEventListener("pointermove", move);
							window.addEventListener("pointerup", up);
						}}
					/>
				)}
				<div
					className={showChat ? "flex min-h-0 min-w-0 flex-1 flex-col border-l sm:flex-none" : "hidden"}
					style={showChat && !phone ? { width: chatWidth } : undefined}
					data-testid="browser-chat-panel"
				>
					<div className="flex items-center gap-2 border-b px-2 py-1.5">
						<label className="min-w-0 flex-1 text-xs text-muted-foreground">
							Session
							<select
								aria-label="Session"
								className="mt-1 h-11 w-full rounded-md border bg-background px-2 text-sm text-foreground"
								value={chat?.id ?? ""}
								onChange={(event) => void loadChat(event.target.value)}
							>
								{chats.length === 0 && <option value="">No sessions yet</option>}
								{chats.map((item) => (
									<option key={item.id} value={item.id}>
										{item.title}
									</option>
								))}
							</select>
						</label>
						<button
							type="button"
							className="mt-4 h-11 shrink-0 rounded-md border px-3 text-sm"
							onClick={() => {
								void fetch("/api/chats", {
									method: "POST",
									headers: { "content-type": "application/json" },
									body: JSON.stringify({ title: "Browser" }),
								})
									.then((res) => res.json())
									.then(async (data: { id?: string }) => {
										if (!data.id) return;
										const listed = await fetch("/api/chats").then((res) => res.json());
										setChats(listed.chats ?? []);
										await loadChat(data.id);
									});
							}}
						>
							New
						</button>
					</div>
					<div className="min-h-0 flex-1">
						{chat ? (
							<Chat
								key={chat.id}
								embedded
								chatId={chat.id}
								title={chat.title}
								kind={chat.kind ?? "teach"}
								initialMessages={chat.messages}
								initiallyInFlight={chat.turnInFlight}
								initiallyCompacting={chat.compacting}
								initialConfigured={initialConfigured}
							/>
						) : (
							<p className="p-4 text-sm text-muted-foreground">Open a session, or start a new one, and ask about this page.</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
