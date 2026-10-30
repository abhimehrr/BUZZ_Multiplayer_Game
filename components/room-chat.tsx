"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "../types";

interface RoomChatProps {
  roomCode: string;
  playerId: string;
  messages: ChatMessage[];
  connected: boolean;
  send: (event: object) => void;
}

const playerColors = ["#a5b4fc", "#7dd3fc", "#5eead4", "#c4b5fd", "#f0abfc", "#fda4af", "#fcd34d", "#bef264", "#67e8f9"];

function colorForPlayer(playerId: string) {
  let hash = 0;
  for (let index = 0; index < playerId.length; index++) hash = (hash * 31 + playerId.charCodeAt(index)) | 0;
  return playerColors[((hash % playerColors.length) + playerColors.length) % playerColors.length];
}

function ChatMessageRow({ message, mine, playerColor, onReply }: {
  message: ChatMessage;
  mine: boolean;
  playerColor: string;
  onReply: (message: ChatMessage) => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const readyToReply = mine ? dragX <= -54 : dragX >= 54;

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    if ((event.target as HTMLElement).closest("button")) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!pointerStart.current) return;
    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;
    if (Math.abs(dx) < Math.abs(dy) * 1.1) return;
    const replyDirection = mine ? dx < 0 : dx > 0;
    setDragX(replyDirection ? Math.sign(dx) * Math.min(Math.abs(dx), 84) : dx * 0.12);
  };
  const finishPointer = (event: React.PointerEvent<HTMLElement>) => {
    const start = pointerStart.current;
    if (start) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.1 && (mine ? dx < 0 : dx > 0)) onReply(message);
    }
    pointerStart.current = null;
    setDragX(0);
    setDragging(false);
  };
  const replyButton = <button type="button" onClick={() => onReply(message)} title={`Reply to ${mine ? "your message" : message.playerName}`} aria-label={`Reply to ${mine ? "your message" : message.playerName}: ${message.text}`} className={`mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl transition ${readyToReply ? "bg-violet-400/20 text-violet-100" : "text-slate-400 hover:bg-white/10 hover:text-violet-200"}`}>↶</button>;

  return <article onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} className={`flex touch-pan-y items-end gap-1.5 ${mine ? "justify-end" : "justify-start"} ${dragging ? "" : "transition-transform duration-200"}`} style={{ transform: `translateX(${dragX}px)` }}>
    {mine ? replyButton : null}
    <div className={`max-w-[84%] min-w-0 rounded-2xl border px-3.5 py-2.5 ${mine ? "rounded-br-md" : "rounded-bl-md"}`} style={{ backgroundColor: `${playerColor}18`, borderColor: `${playerColor}50` }}>
      <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400"><span className="font-semibold" style={{ color: playerColor }}>{mine ? "You" : message.playerName}</span><time dateTime={new Date(message.sentAt).toISOString()}>{new Date(message.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}</time></div>
      {message.replyTo ? <div className="mb-2 rounded-lg border-l-2 border-violet-300/70 bg-black/15 px-2.5 py-1.5 text-xs"><span className="font-semibold text-violet-200">{message.replyTo.playerName}</span><p className="mt-0.5 line-clamp-2 text-slate-300">{message.replyTo.text}</p></div> : null}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p>
    </div>
    {!mine ? replyButton : null}
  </article>;
}

export default function RoomChat({ roomCode, playerId, messages, connected, send }: RoomChatProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
      else launcherRef.current?.focus();
    };
  }, [open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    send({ type: "CHAT_SEND", text, ...(replyTo ? { replyToId: replyTo.id } : {}) });
    setDraft("");
    setReplyTo(null);
  };

  return <>
    <button ref={launcherRef} type="button" onClick={() => setOpen(true)} aria-label={`Open room ${roomCode} chat`} aria-expanded={open} aria-haspopup="dialog" className="fixed bottom-5 right-5 z-40 flex min-h-14 items-center gap-2 rounded-full border border-violet-200/25 bg-violet-600 px-5 font-bold text-white shadow-[0_12px_40px_rgba(91,60,213,.45)] hover:bg-violet-500">
      <span aria-hidden="true" className="text-lg">✉</span> Chat <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs tabular-nums">{messages.length}</span>
    </button>

    {open ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="room-chat-title" className="glass-card flex h-[100dvh] w-full max-w-none flex-col overflow-hidden rounded-none border border-white/15 bg-[#10162a] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl sm:h-[min(760px,92dvh)] sm:max-w-xl sm:rounded-3xl sm:py-0">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div><h2 id="room-chat-title" className="font-bold">Room chat</h2><p className="mt-0.5 text-xs text-slate-400">Everyone in room {roomCode}</p></div>
          <button ref={closeButtonRef} type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-xl text-slate-300 hover:bg-white/10">×</button>
        </header>

        <div aria-live="polite" aria-label="Chat messages" className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {messages.length === 0 ? <div className="flex h-full min-h-48 flex-col items-center justify-center text-center"><span className="text-3xl" aria-hidden="true">💬</span><p className="mt-3 font-semibold">Say hello to the room</p><p className="mt-1 text-sm text-slate-400">Chat is open before, during, and after the game.</p></div> : messages.map((message) => <ChatMessageRow key={message.id} message={message} mine={message.playerId === playerId} playerColor={colorForPlayer(message.playerId)} onReply={setReplyTo} />)}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={submit} className="border-t border-white/10 bg-black/10 p-3 sm:p-4">
          {replyTo ? <div className="mb-2 flex items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 py-2"><span aria-hidden="true" className="text-lg text-violet-200">↶</span><div className="min-w-0 flex-1 text-xs"><span className="font-semibold text-violet-200">Replying to {replyTo.playerId === playerId ? "yourself" : replyTo.playerName}</span><p className="truncate text-slate-300">{replyTo.text}</p></div><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="px-2 text-lg text-slate-400 hover:text-white">×</button></div> : null}
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={1} placeholder={connected ? "Message everyone…" : "Reconnecting to the room…"} aria-label="Chat message" disabled={!connected} className="max-h-32 min-h-12 flex-1 resize-y rounded-2xl border border-white/10 bg-[#11182b] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-300/60 disabled:opacity-50" />
            <button type="submit" disabled={!connected || !draft.trim()} aria-label="Send message" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-xl font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">↑</button>
          </div>
          <p className="mt-2 px-1 text-[11px] text-slate-500">Enter to send · Shift+Enter for a new line</p>
        </form>
      </section>
    </div> : null}
  </>;
}
