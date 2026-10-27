"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoomSnapshot, ServerEvent } from "../types";

const categories = ["All", "General Knowledge", "Science", "Technology", "Geography", "History", "Movies", "Sports", "Food", "India"];
const tokenKey = "buzz-session-token";
const nameKey = "buzz-player-name";
const roomKey = "buzz-room-code";

export default function HomeClient() {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [targetScore, setTargetScore] = useState(50);
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [category, setCategory] = useState("All");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  const send = useCallback((event: object) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
    else setMessage("Reconnecting to the game server. Try again in a moment.");
  }, []);

  useEffect(() => {
    const queryCode = new URLSearchParams(window.location.search).get("code");
    if (queryCode) setCode(queryCode.slice(0, 4));
    setName(localStorage.getItem(nameKey) ?? "");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let retryDelay = 500;
    let retryTimer: number | undefined;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        retryDelay = 500;
        setConnected(true);
        setMessage("");
        const token = localStorage.getItem(tokenKey);
        if (token) socket.send(JSON.stringify({ type: "RECONNECT", token }));
      });
      socket.addEventListener("close", () => {
        if (socketRef.current !== socket) return;
        setConnected(false);
        if (!stopped) {
          retryTimer = window.setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 10_000);
        }
      });
      socket.addEventListener("error", () => setConnected(false));
      socket.addEventListener("message", (event) => {
        const data = JSON.parse(String(event.data)) as ServerEvent;
        if (data.type === "SESSION") {
          localStorage.setItem(tokenKey, data.token);
          localStorage.setItem(roomKey, data.roomCode);
          setPlayerId(data.playerId);
          setBusy(false);
          window.history.replaceState({}, "", `/?code=${data.roomCode}`);
        } else if (data.type === "ROOM_STATE") {
          setRoom(data.room);
          setBusy(false);
          setMessage("");
        } else if (data.type === "ERROR") {
          setBusy(false);
          if (data.code === "SESSION_EXPIRED" || data.code === "KICKED") {
            localStorage.removeItem(tokenKey);
            localStorage.removeItem(roomKey);
            setRoom(null);
            setPlayerId("");
          }
          setMessage(data.message);
        }
      });
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const savedCode = localStorage.getItem(roomKey);
    const token = localStorage.getItem(tokenKey);
    if (!token || !savedCode) return;
    const interval = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "PING" }));
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [connected]);

  const isMaster = useMemo(() => room?.masterId === playerId, [room, playerId]);
  const connectedPlayers = room?.players.filter((player) => player.connected).length ?? 0;
  const inviteLink = typeof window === "undefined" || !room ? "" : `${window.location.origin}/join?code=${room.code}`;
  const persistName = (value: string) => { const clean = value.slice(0, 16); setName(clean); localStorage.setItem(nameKey, clean); };
  const submitCreate = (event: React.FormEvent) => {
    event.preventDefault(); setMessage(""); setBusy(true);
    send({ type: "CREATE_ROOM", name, targetScore, maxPlayers, category });
  };
  const submitJoin = (event: React.FormEvent) => {
    event.preventDefault(); setMessage(""); setBusy(true);
    send({ type: "JOIN_ROOM", name, code: code.replace(/\D/g, "").slice(0, 4) });
  };
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(""), 1600); }
    catch { setMessage("Copy was blocked by your browser. You can select and copy the text instead."); }
  };

  if (room && room.phase === "lobby") return <main className="min-h-screen px-4 py-8 sm:px-8"><div className="mx-auto max-w-4xl">
    <header className="flex items-center justify-between"><a href="/" className="text-2xl font-black tracking-tight">BUZZ<span className="text-amber-300">.</span></a><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{connected ? "● Connected" : "○ Reconnecting…"}</span></header>
    <section className="glass-card mt-8 rounded-3xl p-5 sm:p-8">
      <div className="text-center"><p className="text-xs font-semibold uppercase tracking-[.3em] text-violet-300">Room code</p><div className="mt-2 text-5xl font-black tracking-[.24em] text-white sm:text-6xl">{room.code}</div>
        <div className="mt-4 flex flex-wrap justify-center gap-2"><button onClick={() => void copy(room.code,"code")} className="secondary-btn">{copied==="code"?"Copied!":"Copy code"}</button><button onClick={() => void copy(inviteLink,"link")} className="secondary-btn">{copied==="link"?"Link copied!":"Copy invite link"}</button></div></div>
      <div className="mt-8 grid gap-6 md:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-white/10 bg-black/15 p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Players</h2><span className="text-sm text-slate-400">{room.players.length}/{room.maxPlayers}</span></div>
          <ul className="mt-4 space-y-3">{room.players.map((p) => <li key={p.id} className="flex items-center gap-3 rounded-xl bg-white/5 p-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/20 font-bold text-violet-200">{p.name.slice(0,1).toUpperCase()}</span><div className="min-w-0 flex-1"><div className="font-medium">{p.name}{p.id===playerId?<span className="ml-2 text-xs text-violet-300">You</span>:null}</div><div className="text-xs text-slate-400">{p.isMaster?"Host":p.connected?"Ready":"Reconnecting…"}</div></div>{isMaster&&p.id!==playerId?<button aria-label={`Remove ${p.name}`} onClick={()=>send({type:"KICK",playerId:p.id})} className="text-xs text-rose-300 hover:text-rose-200">Remove</button>:null}</li>)}</ul>
          {connectedPlayers<2?<p className="mt-4 text-sm text-amber-200">Waiting for at least one more player to join.</p>:null}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/15 p-5"><h2 className="font-bold">Game settings</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><dt className="text-slate-400">Winning score</dt><dd className="font-semibold text-amber-200">{room.targetScore} points</dd></div><div className="flex justify-between"><dt className="text-slate-400">Player limit</dt><dd>{room.maxPlayers}</dd></div><div className="flex justify-between"><dt className="text-slate-400">Category</dt><dd>{room.category}</dd></div></dl>
          {isMaster?<button disabled={connectedPlayers<2||busy} onClick={()=>{setBusy(true);send({type:"START_GAME"})}} className="primary-btn mt-8 w-full disabled:cursor-not-allowed disabled:opacity-40">{busy?"Starting…":"Start game"}</button>:<p className="mt-8 rounded-xl bg-white/5 p-3 text-center text-sm text-slate-300">The host will start when everyone is ready.</p>}
          {connectedPlayers>=2&&isMaster?<p className="mt-3 text-center text-xs text-slate-400">The game engine is coming in the next build stage.</p>:null}
        </div>
      </div>
    </section><button onClick={()=>{send({type:"LEAVE"});localStorage.removeItem(tokenKey);localStorage.removeItem(roomKey);setRoom(null);setPlayerId("")}} className="mx-auto mt-5 block text-sm text-slate-400 hover:text-white">Leave room</button>
    {message?<p role="alert" className="mx-auto mt-4 max-w-xl rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-center text-sm text-rose-100">{message}</p>:null}
  </div></main>;

  if (room && room.phase !== "lobby") return <main className="min-h-screen px-5 py-10"><section className="glass-card mx-auto mt-16 max-w-xl rounded-3xl p-8 text-center"><h1 className="text-4xl font-black">Room {room.code}</h1><p className="mt-4 text-slate-300">The room is ready. The question and buzzer experience is the next build stage.</p><button className="secondary-btn mt-6" onClick={()=>send({type:"LEAVE"})}>Leave room</button></section></main>;

  return <main className="min-h-screen px-4 py-10 sm:px-8"><div className="mx-auto max-w-5xl">
    <header className="flex items-center justify-between"><a href="/" className="text-2xl font-black tracking-tight">BUZZ<span className="text-amber-300">.</span></a><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{connected?"● Server connected":"○ Connecting…"}</span></header>
    <section className="mx-auto flex min-h-[76vh] max-w-3xl flex-col justify-center text-center"><p className="text-xs font-semibold uppercase tracking-[.34em] text-violet-300">Fast minds. Faster fingers.</p><h1 className="mt-3 text-7xl font-black tracking-tight sm:text-8xl">BUZZ<span className="text-amber-300">.</span></h1><p className="mx-auto mt-4 max-w-lg text-slate-300">A quick, competitive quiz for friends. Hear the question, hit the buzzer, and claim your answer.</p>
      <div className="mt-9 grid gap-4 text-left sm:grid-cols-2">
        <form onSubmit={submitCreate} className="glass-card rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-bold">Create a room</h2><label className="field-label mt-5">Your name<input required maxLength={16} value={name} onChange={e=>persistName(e.target.value)} placeholder="e.g. Riya" className="field-input"/></label><div className="mt-4 grid grid-cols-2 gap-3"><label className="field-label">Target score<select value={targetScore} onChange={e=>setTargetScore(Number(e.target.value))} className="field-input">{Array.from({length:10},(_,i)=>(i+1)*10).map(n=><option key={n} value={n}>{n} points</option>)}</select></label><label className="field-label">Players<select value={maxPlayers} onChange={e=>setMaxPlayers(Number(e.target.value))} className="field-input">{[2,3,4,5].map(n=><option key={n} value={n}>{n} players</option>)}</select></label></div><label className="field-label mt-4">Question category<select value={category} onChange={e=>setCategory(e.target.value)} className="field-input">{categories.map(c=><option key={c}>{c}</option>)}</select></label><button disabled={!connected||busy||!name.trim()} className="primary-btn mt-5 w-full disabled:opacity-40">{busy?"Creating…":"Create room"}</button></form>
        <form onSubmit={submitJoin} className="glass-card rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-bold">Join a room</h2><label className="field-label mt-5">Your name<input required maxLength={16} value={name} onChange={e=>persistName(e.target.value)} placeholder="Choose a display name" className="field-input"/></label><label className="field-label mt-4">4-digit room code<input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="1234" className="field-input text-lg tracking-[.25em]"/></label><button disabled={!connected||busy||!name.trim()||code.length!==4} className="secondary-btn mt-5 w-full disabled:opacity-40">{busy?"Joining…":"Join room"}</button><p className="mt-4 text-xs leading-5 text-slate-400">Your host will share a room code or invite link. You can join on a phone, tablet, or laptop.</p></form>
      </div>
      {message?<p role="alert" className="mx-auto mt-4 max-w-xl rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">{message}</p>:null}
      <p className="mt-6 text-xs text-slate-500">Room state is live. Scores and game rounds arrive in the next stage.</p>
    </section>
  </div></main>;
}
