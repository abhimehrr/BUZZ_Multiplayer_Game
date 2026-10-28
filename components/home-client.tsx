"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameSnapshot, RoomSnapshot, ServerEvent } from "../types";

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
  const playerIdRef = useRef("");
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [options, setOptions] = useState<[string, string, string, string] | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answererName, setAnswererName] = useState("");
  const [roundResult, setRoundResult] = useState<Extract<ServerEvent, { type: "ROUND_RESULT" }> | null>(null);
  const [gameOver, setGameOver] = useState<Extract<ServerEvent, { type: "GAME_OVER" }> | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [statusNotice, setStatusNotice] = useState("");
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
    const socketUrl = `${protocol}//${window.location.host}/ws`;
    let retryDelay = 1_000;
    let retryTimer: number | undefined;
    let stableTimer: number | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const currentSocket = socketRef.current;
      if (currentSocket && currentSocket.readyState !== WebSocket.CLOSED) return;

      const socket = new WebSocket(socketUrl);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (socketRef.current !== socket) return;
        if (retryTimer !== undefined) {
          window.clearTimeout(retryTimer);
          retryTimer = undefined;
        }
        setConnected(true);
        setMessage("");
        const token = localStorage.getItem(tokenKey);
        if (token) socket.send(JSON.stringify({ type: "RECONNECT", token }));
        socket.send(JSON.stringify({ type: "PING" }));

        stableTimer = window.setTimeout(() => {
          retryDelay = 1_000;
          stableTimer = undefined;
        }, 30_000);
      });

      socket.addEventListener("close", (event) => {
        console.info("[ws] disconnected", {
          code: event.code,
          reason: event.reason || "No close reason supplied",
          wasClean: event.wasClean,
        });
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        if (stableTimer !== undefined) {
          window.clearTimeout(stableTimer);
          stableTimer = undefined;
        }
        setConnected(false);
        if (!stopped && retryTimer === undefined) {
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            connect();
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 15_000);
        }
      });

      socket.addEventListener("error", () => {
        if (socketRef.current === socket) setMessage("Connection interrupted. Trying to reconnect…");
      });

      socket.addEventListener("message", (event) => {
        let data: ServerEvent;
        try {
          data = JSON.parse(String(event.data)) as ServerEvent;
        } catch (error) {
          console.error("[ws] received invalid server message", error);
          return;
        }

        if (data.type === "SESSION_MOVED") {
          stopped = true;
          if (retryTimer !== undefined) window.clearTimeout(retryTimer);
          retryTimer = undefined;
          if (stableTimer !== undefined) window.clearTimeout(stableTimer);
          stableTimer = undefined;
          socketRef.current = null;
          setConnected(false);
          setBusy(false);
          setStatusNotice(data.message);
        } else if (data.type === "SESSION") {
          localStorage.setItem(tokenKey, data.token);
          localStorage.setItem(roomKey, data.roomCode);
          playerIdRef.current = data.playerId;
          setPlayerId(data.playerId);
          setBusy(false);
          window.history.replaceState({}, "", `/?code=${data.roomCode}`);
        } else if (data.type === "ROOM_STATE") {
          setRoom(data.room);
          setBusy(false);
          setMessage("");
          if (data.room.phase === "lobby") {
            setGame(null);
            setOptions(null);
            setSelectedOption(null);
            setRoundResult(null);
            setGameOver(null);
            setStatusNotice("");
          }
        } else if (data.type === "QUESTION") {
          setGame({ phase: "question", round: data.round, roundCap: 30, question: data.question, deadline: data.deadline });
          setOptions(null);
          setSelectedOption(null);
          setRoundResult(null);
          setGameOver(null);
          setAnswererName("");
          setStatusNotice("");
        } else if (data.type === "GAME_STATE") {
          setGame(data.game);
          if (data.game.phase === "question") {
            setOptions(null);
            setSelectedOption(null);
            setRoundResult(null);
            setGameOver(null);
          } else if (data.game.phase !== "answering" || data.game.answererId !== playerIdRef.current) {
            setOptions(null);
            setSelectedOption(null);
          }
        } else if (data.type === "BUZZ_WON") {
          setAnswererName(data.playerName);
          setGame((previous) => previous ? { ...previous, phase: "answering", answererId: data.playerId, deadline: data.deadline } : previous);
          setStatusNotice("");
        } else if (data.type === "OPTIONS") {
          setOptions(data.options);
          setSelectedOption(null);
        } else if (data.type === "ROUND_RESULT") {
          setRoundResult(data);
          setSelectedOption(data.playerId === playerIdRef.current ? data.selectedIndex ?? null : null);
        } else if (data.type === "GAME_OVER") {
          setGameOver(data);
          setOptions(null);
          setSelectedOption(null);
        } else if (data.type === "PONG") {
          setServerOffset(data.serverTime - Date.now());
        } else if (data.type === "ERROR") {
          setBusy(false);
          if (data.code === "SESSION_EXPIRED" || data.code === "KICKED") {
            localStorage.removeItem(tokenKey);
            localStorage.removeItem(roomKey);
            playerIdRef.current = "";
            setRoom(null);
            setPlayerId("");
            setGame(null);
          }
          if (data.code === "TOO_LATE") {
            setStatusNotice("You were too late");
            window.setTimeout(() => setStatusNotice(""), 2_500);
          } else if (data.code === "ANSWER_TIMEOUT") {
            setStatusNotice("Time's up");
            window.setTimeout(() => setStatusNotice(""), 2_500);
          } else {
            setMessage(data.message);
          }
        }
      });
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (stableTimer !== undefined) window.clearTimeout(stableTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!connected) return;
    const interval = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "PING" }));
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [connected]);

  useEffect(() => {
    if (game?.deadline === undefined) return;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [game?.deadline]);

  const isMaster = useMemo(() => room?.masterId === playerId, [room, playerId]);
  const connectedPlayers = room?.players.filter((player) => player.connected).length ?? 0;
  const remainingSeconds = game?.deadline === undefined ? 0 : Math.max(0, Math.ceil((game.deadline - (clock + serverOffset)) / 1000));
  const answererDisplayName = game?.answererId === playerId ? "You" : answererName || room?.players.find((player) => player.id === game?.answererId)?.name || "A player";
  const statusText = statusNotice || (!game
    ? "Preparing the first question…"
    : game.phase === "question"
      ? `Question ${game.round} of up to ${game.roundCap} · Press BUZZ!`
      : game.phase === "answering"
        ? `${answererDisplayName} is answering (${remainingSeconds}s)`
        : game.phase === "reveal"
          ? roundResult?.correct === true
            ? "Correct answer!"
            : roundResult?.correct === false
              ? roundResult.timedOut ? "Time's up" : "Wrong answer"
              : roundResult ? "Time's up · no one buzzed" : "Answer revealed"
          : game.phase === "paused"
            ? "Waiting for players…"
            : "Game over");
  const progressPercent = (score: number) => room ? Math.min(100, Math.max(0, score / room.targetScore * 100)) : 0;
  const answerTimeLimit = game?.phase === "answering" ? 15 : 30;
  const isAnswerer = game?.phase === "answering" && game.answererId === playerId;
  const canBuzz = connected && game?.phase === "question";

  const leaveRoom = () => {
    send({ type: "LEAVE" });
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(roomKey);
    playerIdRef.current = "";
    setRoom(null);
    setPlayerId("");
    setGame(null);
    setGameOver(null);
  };
  const pressBuzz = () => {
    if (!canBuzz) return;
    if ("vibrate" in navigator) navigator.vibrate(25);
    send({ type: "BUZZ" });
  };
  const answer = (optionIndex: number) => {
    if (!isAnswerer || selectedOption !== null) return;
    setSelectedOption(optionIndex);
    send({ type: "SUBMIT_ANSWER", optionIndex });
  };
  const endGame = () => {
    if (window.confirm("End this game for everyone?")) send({ type: "END_GAME" });
  };
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
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const temporaryInput = document.createElement("textarea");
        temporaryInput.value = value;
        temporaryInput.style.position = "fixed";
        temporaryInput.style.opacity = "0";
        document.body.appendChild(temporaryInput);
        temporaryInput.select();
        const copied = document.execCommand("copy");
        temporaryInput.remove();
        if (!copied) throw new Error("Clipboard access is unavailable.");
      }
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setMessage("Copy was blocked by your browser. You can select and copy the text instead.");
    }
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
          {connectedPlayers>=2&&isMaster?<p className="mt-3 text-center text-xs text-slate-400">Questions are ready. Start when everyone is in.</p>:null}
        </div>
      </div>
    </section><button onClick={()=>{send({type:"LEAVE"});localStorage.removeItem(tokenKey);localStorage.removeItem(roomKey);setRoom(null);setPlayerId("")}} className="mx-auto mt-5 block text-sm text-slate-400 hover:text-white">Leave room</button>
    {message?<p role="alert" className="mx-auto mt-4 max-w-xl rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-center text-sm text-rose-100">{message}</p>:null}
  </div></main>;

  if (room && gameOver) return <main className="min-h-screen px-4 py-8 sm:px-8"><div className="mx-auto max-w-4xl">
    <header className="flex items-center justify-between"><a href="/" className="text-2xl font-black tracking-tight">BUZZ<span className="text-amber-300">.</span></a><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">Room {room.code}</span></header>
    <section className="glass-card mt-8 rounded-3xl p-6 sm:p-9">
      <p className="text-center text-xs font-semibold uppercase tracking-[.32em] text-violet-300">Game over</p>
      <h1 className="mt-3 text-center text-4xl font-black sm:text-5xl">{gameOver.winners.length > 1 ? "It's a tie!" : `${gameOver.winners[0] ?? "No winner"} wins!`}</h1>
      <p className="mt-3 text-center text-slate-300">{gameOver.winners.length > 1 ? `Co-winners: ${gameOver.winners.join(", ")}` : `Congratulations, ${gameOver.winners[0] ?? "everyone"}.`}</p>
      <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[520px] text-left text-sm"><thead className="bg-white/5 text-xs uppercase tracking-wider text-slate-400"><tr><th className="p-3">Player</th><th className="p-3">Score</th><th className="p-3">Correct</th><th className="p-3">Wrong</th><th className="p-3">Accuracy</th></tr></thead>
          <tbody>{gameOver.leaderboard.map((entry, index) => <tr key={entry.playerId} className="border-t border-white/5"><td className="p-3 font-semibold">{index + 1}. {entry.name}{entry.playerId === playerId ? " (You)" : ""}</td><td className="p-3 font-bold text-amber-200">{entry.score}</td><td className="p-3 text-emerald-200">{entry.correctCount}</td><td className="p-3 text-rose-200">{entry.wrongCount}</td><td className="p-3">{entry.accuracy}%</td></tr>)}</tbody></table>
      </div>
      {isMaster?<button onClick={()=>send({type:"PLAY_AGAIN"})} className="primary-btn mt-7 w-full">Play again</button>:<p className="mt-7 text-center text-sm text-slate-300">The host can start another game from this room.</p>}
      <button onClick={leaveRoom} className="secondary-btn mt-3 w-full">Leave room</button>
    </section>
  </div></main>;

  if (room && room.phase !== "lobby") return <main className="min-h-screen px-3 py-5 sm:px-6 sm:py-8"><div className="mx-auto max-w-5xl">
    <header className="flex items-center justify-between"><a href="/" className="text-2xl font-black tracking-tight">BUZZ<span className="text-amber-300">.</span></a><div className="flex items-center gap-2"><span className="hidden text-xs text-slate-400 sm:inline">Room {room.code}</span><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{connected?"● Connected":"○ Reconnecting…"}</span>{isMaster?<button onClick={endGame} className="secondary-btn min-h-0 px-3 py-1 text-xs text-rose-200">End game</button>:null}</div></header>

    <section aria-label="Live scoreboard" className="glass-card sticky top-2 z-20 mt-4 rounded-2xl p-3 shadow-2xl">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400"><span>Scoreboard</span><span>Target {room.targetScore}</span></div>
      <div className="flex gap-2 overflow-x-auto pb-1">{room.players.map((player) => <div key={player.id} className={`min-w-[132px] flex-1 rounded-xl border p-2 ${player.id===playerId?"border-violet-400/40 bg-violet-500/10":"border-white/5 bg-white/[.03]"}`}>
        <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold">{player.name}{player.id===playerId?" · You":""}</span><span className="font-bold tabular-nums text-amber-200">{player.score}</span></div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-amber-300 transition-all" style={{width:`${progressPercent(player.score)}%`}}/></div>
        <div className="mt-1 text-[10px] text-slate-400"><span className="text-emerald-200">✓ {player.correctCount}</span><span className="mx-2 text-rose-200">✕ {player.wrongCount}</span></div>
      </div>)}</div>
    </section>

    <div role="status" aria-live="polite" className={`mt-4 rounded-xl border px-4 py-3 text-center text-sm font-semibold ${game?.phase==="reveal"&&roundResult?.correct===true?"border-emerald-400/30 bg-emerald-400/10 text-emerald-100":game?.phase==="reveal"&&roundResult?.correct===false?"border-rose-400/30 bg-rose-400/10 text-rose-100":"border-violet-300/20 bg-violet-400/10 text-violet-100"}`}>{statusText}</div>

    <section className="glass-card mt-4 rounded-3xl p-5 text-center sm:p-8">
      <div className="flex items-center justify-between text-xs text-slate-400"><span>{game?.question?.category ?? room.category}</span><span>{game?.round ? `Round ${game.round} / ${game.roundCap}` : ""}</span></div>
      <div className="mx-auto mt-5 flex min-h-28 max-w-3xl items-center justify-center text-balance text-2xl font-bold leading-snug sm:min-h-36 sm:text-3xl">{game?.question?.question ?? "Preparing the first question…"}</div>

      {game?.deadline!==undefined&&game.phase!=="paused"&&game.phase!=="reveal"&&game.phase!=="gameOver"?<div className="mx-auto mt-4 flex h-14 w-14 items-center justify-center rounded-full p-[3px]" style={{background:`conic-gradient(#ffb84d ${Math.max(0,Math.min(100,remainingSeconds/answerTimeLimit*100))}%,rgba(255,255,255,.12) 0)`}}><div className="flex h-full w-full items-center justify-center rounded-full bg-[#11172b] text-lg font-black tabular-nums">{remainingSeconds}</div></div>:null}

      {game?.phase==="answering"&&isAnswerer?<div className="mx-auto mt-5 grid max-w-2xl gap-3 sm:grid-cols-2">{options?.map((option,index)=><button key={index} disabled={selectedOption!==null} onClick={()=>answer(index)} className={`rounded-xl border p-4 text-left font-semibold transition ${selectedOption===index?"border-violet-300 bg-violet-500/25":"border-white/10 bg-white/5 hover:border-violet-300/50 hover:bg-violet-500/10"} disabled:opacity-60`}><span className="mr-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs">{String.fromCharCode(65+index)}</span>{option}</button>) ?? <p className="col-span-2 text-slate-300">Loading your options…</p>}</div>:null}

      {game?.phase==="answering"&&!isAnswerer?<p className="mt-5 text-sm text-slate-300">{answererDisplayName} has the options. Everyone else, hang tight.</p>:null}

      {game?.phase==="reveal"&&roundResult?<div className="mx-auto mt-5 max-w-xl rounded-2xl border border-white/10 bg-white/5 p-5"><p className="text-xs uppercase tracking-[.2em] text-slate-400">Correct answer</p><p className="mt-2 text-xl font-bold text-emerald-200">{roundResult.correctAnswer}</p>{roundResult.playerId?<p className="mt-2 text-sm text-slate-300">{room.players.find((player)=>player.id===roundResult.playerId)?.name} {roundResult.correct?"answered correctly.":roundResult.timedOut?"ran out of time.":"answered incorrectly."}</p>:<p className="mt-2 text-sm text-slate-300">No one buzzed in time.</p>}</div>:null}

      {game?.phase==="question"?<button onClick={pressBuzz} disabled={!canBuzz} className={`mx-auto mt-6 flex h-48 w-48 items-center justify-center rounded-full border-8 text-3xl font-black tracking-widest transition-all sm:h-56 sm:w-56 ${canBuzz?"animate-pulse border-violet-200/40 bg-gradient-to-br from-violet-500 to-violet-800 shadow-[0_0_60px_rgba(124,92,255,.42)] hover:scale-105 active:scale-95":"cursor-not-allowed border-slate-600/40 bg-slate-700/50 text-slate-400"}`} aria-label="Press buzzer">BUZZ</button>:null}
      {game?.phase==="answering"&&isAnswerer?<p className="mt-5 text-sm text-amber-100">Choose one answer before the countdown ends.</p>:null}
      {game?.phase==="paused"?<p className="mx-auto mt-6 max-w-md rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">The game will resume when at least two players reconnect.</p>:null}
    </section>
    {message?<p role="alert" className="mx-auto mt-4 max-w-xl rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-center text-sm text-rose-100">{message}</p>:null}
  </div></main>;

  return <main className="min-h-screen px-4 py-10 sm:px-8"><div className="mx-auto max-w-5xl">
    <header className="flex items-center justify-between"><a href="/" className="text-2xl font-black tracking-tight">BUZZ<span className="text-amber-300">.</span></a><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{connected?"● Server connected":"○ Connecting…"}</span></header>
    <section className="mx-auto flex min-h-[76vh] max-w-3xl flex-col justify-center text-center"><p className="text-xs font-semibold uppercase tracking-[.34em] text-violet-300">Fast minds. Faster fingers.</p><h1 className="mt-3 text-7xl font-black tracking-tight sm:text-8xl">BUZZ<span className="text-amber-300">.</span></h1><p className="mx-auto mt-4 max-w-lg text-slate-300">A quick, competitive quiz for friends. Hear the question, hit the buzzer, and claim your answer.</p>
      <div className="mt-9 grid gap-4 text-left sm:grid-cols-2">
        <form onSubmit={submitCreate} className="glass-card rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-bold">Create a room</h2><label className="field-label mt-5">Your name<input required maxLength={16} value={name} onChange={e=>persistName(e.target.value)} placeholder="e.g. Riya" className="field-input"/></label><div className="mt-4 grid grid-cols-2 gap-3"><label className="field-label">Target score<select value={targetScore} onChange={e=>setTargetScore(Number(e.target.value))} className="field-input">{Array.from({length:10},(_,i)=>(i+1)*10).map(n=><option key={n} value={n}>{n} points</option>)}</select></label><label className="field-label">Players<select value={maxPlayers} onChange={e=>setMaxPlayers(Number(e.target.value))} className="field-input">{[2,3,4,5].map(n=><option key={n} value={n}>{n} players</option>)}</select></label></div><label className="field-label mt-4">Question category<select value={category} onChange={e=>setCategory(e.target.value)} className="field-input">{categories.map(c=><option key={c}>{c}</option>)}</select></label><button disabled={!connected||busy||!name.trim()} className="primary-btn mt-5 w-full disabled:opacity-40">{busy?"Creating…":"Create room"}</button></form>
        <form onSubmit={submitJoin} className="glass-card rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-bold">Join a room</h2><label className="field-label mt-5">Your name<input required maxLength={16} value={name} onChange={e=>persistName(e.target.value)} placeholder="Choose a display name" className="field-input"/></label><label className="field-label mt-4">4-digit room code<input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="1234" className="field-input text-lg tracking-[.25em]"/></label><button disabled={!connected||busy||!name.trim()||code.length!==4} className="secondary-btn mt-5 w-full disabled:opacity-40">{busy?"Joining…":"Join room"}</button><p className="mt-4 text-xs leading-5 text-slate-400">Your host will share a room code or invite link. You can join on a phone, tablet, or laptop.</p></form>
      </div>
      {message?<p role="alert" className="mx-auto mt-4 max-w-xl rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">{message}</p>:null}
      <p className="mt-6 text-xs text-slate-500">Room state is live. Gather your players, choose a room, and race to the target score.</p>
    </section>
  </div></main>;
}
