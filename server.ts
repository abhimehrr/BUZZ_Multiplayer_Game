import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";
import type { ChatMessage, ClientEvent, GameQuestion, GameSnapshot, LeaderboardEntry, PublicQuestion, ScorePlayer, ServerEvent } from "./types";
import { advanceQuestion, ANSWER_TIME_MS, claimBuzz, createGameState, pauseGame, QUESTION_TIME_MS, resolveRound, resumeGame, ROUND_CAP, selectWinners, startGame } from "./game/machine";
import { loadQuestions } from "./game/questions";
import { clearRoom, createPlayer, createRoomCode, getRoomSnapshot, playersByToken, removePlayer, rooms, type Player, type Room } from "./game/rooms";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const origins = (process.env.ALLOWED_ORIGIN ?? "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const socketPlayers = new WeakMap<WebSocket, Player>();
const buzzWindows = new WeakMap<Player, { startedAt: number; count: number }>();

function send(ws: WebSocket, event: ServerEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
}
function fail(ws: WebSocket, code: string, message: string) { send(ws, { type: "ERROR", code, message }); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function validEvent(value: unknown): value is ClientEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "CREATE_ROOM": return typeof value.name === "string" && typeof value.targetScore === "number" && typeof value.maxPlayers === "number" && (value.category === undefined || typeof value.category === "string");
    case "JOIN_ROOM": return typeof value.code === "string" && typeof value.name === "string";
    case "RECONNECT": return typeof value.token === "string";
    case "KICK": return typeof value.playerId === "string";
    case "UPDATE_SETTINGS": return (value.targetScore === undefined || typeof value.targetScore === "number") && (value.maxPlayers === undefined || typeof value.maxPlayers === "number") && (value.category === undefined || typeof value.category === "string");
    case "CHAT_SEND": return typeof value.text === "string" && (value.replyToId === undefined || typeof value.replyToId === "string");
    case "SUBMIT_ANSWER": return typeof value.optionIndex === "number";
    case "START_GAME": case "BUZZ": case "END_GAME": case "PLAY_AGAIN": case "RESIGN": case "LEAVE": case "PING": return true;
    default: return false;
  }
}
function sendRoom(room: Room) {
  const event: ServerEvent = { type: "ROOM_STATE", room: getRoomSnapshot(room) };
  for (const player of room.players) if (player.ws) send(player.ws, event);
}
function sendChatHistory(room: Room, ws: WebSocket) {
  send(ws, { type: "CHAT_HISTORY", messages: room.chatMessages });
}
function broadcastChatMessage(room: Room, message: ChatMessage) {
  const event: ServerEvent = { type: "CHAT_MESSAGE", message };
  for (const player of room.players) if (player.ws) send(player.ws, event);
}
function scorePlayers(room: Room): ScorePlayer[] {
  return room.players.map(({ id, name, score, correctCount, wrongCount }) => ({ id, name, score, correctCount, wrongCount }));
}
function activePlayers(room: Room) { return room.players.filter((player) => !player.resigned); }
function activeScorePlayers(room: Room): ScorePlayer[] {
  const activeIds = new Set(activePlayers(room).map((player) => player.id));
  return scorePlayers(room).filter((player) => activeIds.has(player.id));
}
function connectedActiveCount(room: Room) { return room.players.filter((player) => player.connected && !player.resigned).length; }
function requiredActiveCount(room: Room) { return Math.min(2, activePlayers(room).length); }
function updateScores(room: Room, scored: ScorePlayer[]) {
  const byId = new Map(scored.map((player) => [player.id, player]));
  for (const player of room.players) {
    const score = byId.get(player.id);
    if (score) { player.score = score.score; player.correctCount = score.correctCount; player.wrongCount = score.wrongCount; }
  }
}
function makeLeaderboard(room: Room): LeaderboardEntry[] {
  return room.players.map((player) => {
    const answered = player.correctCount + player.wrongCount;
    return { playerId: player.id, name: player.name, score: player.score, correctCount: player.correctCount, wrongCount: player.wrongCount, accuracy: answered ? Math.round(player.correctCount / answered * 100) : 0, resigned: player.resigned };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
function getPublicQuestion(question: GameQuestion | undefined): PublicQuestion | undefined {
  if (!question) return undefined;
  return { id: question.id, category: question.category, difficulty: question.difficulty, question: question.question };
}
function gameSnapshot(room: Room): GameSnapshot | undefined {
  const game = room.game;
  if (!game) return undefined;
  return { phase: game.phase, round: game.round, roundCap: game.roundCap, question: getPublicQuestion(game.currentQuestion), answererId: game.answererId, deadline: game.deadline };
}
function broadcastGameState(room: Room) {
  const game = gameSnapshot(room);
  if (!game) return;
  const event: ServerEvent = { type: "GAME_STATE", game };
  for (const player of room.players) if (player.ws) send(player.ws, event);
}
function sendQuestion(room: Room) {
  if (!room.game?.currentQuestion || room.game.deadline === undefined) return;
  const event: ServerEvent = { type: "QUESTION", question: getPublicQuestion(room.game.currentQuestion)!, round: room.game.round, deadline: room.game.deadline };
  for (const player of room.players) if (player.ws) send(player.ws, event);
}
function clearGameTimer(room: Room) {
  if (room.gameTimer) clearTimeout(room.gameTimer);
  room.gameTimer = undefined;
}
function broadcastBuzzWon(room: Room) {
  const game = room.game;
  if (!game?.answererId || game.deadline === undefined) return;
  const player = room.players.find((candidate) => candidate.id === game.answererId);
  if (!player) return;
  const event: ServerEvent = { type: "BUZZ_WON", playerId: player.id, playerName: player.name, deadline: game.deadline };
  for (const candidate of room.players) if (candidate.ws) send(candidate.ws, event);
}
function sendOptionsToAnswerer(room: Room) {
  const game = room.game;
  if (!game?.answererId || !game.currentQuestion) return;
  const answerer = room.players.find((player) => player.id === game.answererId);
  if (answerer?.ws) send(answerer.ws, { type: "OPTIONS", options: game.currentQuestion.options });
}
function sendRoundResult(room: Room) {
  if (room.lastResult) {
    const event: ServerEvent = { type: "ROUND_RESULT", ...room.lastResult };
    for (const player of room.players) if (player.ws) send(player.ws, event);
  }
}
function sendGameOver(room: Room, winners: ScorePlayer[]) {
  const event: ServerEvent = { type: "GAME_OVER", winners: winners.map((player) => player.name), leaderboard: makeLeaderboard(room) };
  for (const player of room.players) if (player.ws) send(player.ws, event);
}
function finishGame(room: Room, winners?: ScorePlayer[]) {
  clearGameTimer(room);
  if (room.game) {
    room.game = { ...room.game, phase: "gameOver", deadline: undefined, answererId: undefined, pausedPhase: undefined, remainingMs: undefined };
    room.phase = "gameOver";
    sendRoom(room);
    broadcastGameState(room);
  } else {
    room.phase = "gameOver";
    sendRoom(room);
  }
  sendGameOver(room, winners ?? selectWinners(activeScorePlayers(room), room.targetScore, true));
}
function armTimer(room: Room) {
  clearGameTimer(room);
  const game = room.game;
  if (!game || game.deadline === undefined) return;
  const delay = Math.max(0, game.deadline - Date.now());
  room.gameTimer = setTimeout(() => {
    room.gameTimer = undefined;
    if (!room.game) return;
    if (room.game.phase === "question") resolveCurrentRound(room, null);
    else if (room.game.phase === "answering") resolveCurrentRound(room, null);
    else if (room.game.phase === "reveal") advanceToNextQuestion(room);
  }, delay);
}
function publishQuestion(room: Room) {
  room.phase = "question";
  sendRoom(room);
  broadcastGameState(room);
  sendQuestion(room);
  armTimer(room);
}
function resolveCurrentRound(room: Room, optionIndex: number | null) {
  if (!room.game) return;
  clearGameTimer(room);
  const now = Date.now();
  const resolution = resolveRound(room.game, activeScorePlayers(room), optionIndex, now);
  if (!resolution) return;
  room.game = resolution.state;
  room.phase = resolution.state.phase;
  room.lastResult = resolution.result;
  updateScores(room, resolution.players);
  sendRoom(room);
  broadcastGameState(room);
  sendRoundResult(room);
  if (resolution.winners.length) finishGame(room, resolution.winners);
  else armTimer(room);
}
function advanceToNextQuestion(room: Room) {
  if (!room.game) return;
  clearGameTimer(room);
  const next = advanceQuestion(room.game, activeScorePlayers(room), Date.now());
  room.game = next.state;
  if (next.state.phase === "gameOver") {
    finishGame(room, next.winners);
    return;
  }
  room.lastResult = undefined;
  room.phase = next.state.phase;
  if (connectedActiveCount(room) < requiredActiveCount(room)) {
    room.game = pauseGame(room.game, Date.now());
    room.phase = "paused";
    sendRoom(room);
    broadcastGameState(room);
    return;
  }
  publishQuestion(room);
}
function pauseIfNeeded(room: Room) {
  if (!room.game || (room.game.phase !== "question" && room.game.phase !== "answering")) return;
  if (connectedActiveCount(room) >= requiredActiveCount(room)) return;
  clearGameTimer(room);
  room.game = pauseGame(room.game, Date.now());
  room.phase = room.game.phase;
  sendRoom(room);
  broadcastGameState(room);
}
function resumeIfReady(room: Room) {
  if (room.phase !== "paused" || !room.game || connectedActiveCount(room) < requiredActiveCount(room)) return;
  room.game = resumeGame(room.game, Date.now());
  room.phase = room.game.phase;
  sendRoom(room);
  broadcastGameState(room);
  if (room.game.phase === "question") sendQuestion(room);
  if (room.game.phase === "answering") { broadcastBuzzWon(room); sendOptionsToAnswerer(room); }
  armTimer(room);
}
function sendCurrentState(room: Room, player: Player) {
  sendRoom(room);
  if (!room.game) return;
  const snapshot = gameSnapshot(room);
  if (snapshot) send(player.ws!, { type: "GAME_STATE", game: snapshot });
  if (room.phase === "question") sendQuestion(room);
  else if (room.phase === "answering") {
    broadcastBuzzWon(room);
    sendOptionsToAnswerer(room);
  } else if (room.phase === "reveal") sendRoundResult(room);
  else if (room.phase === "gameOver") sendGameOver(room, selectWinners(activeScorePlayers(room), room.targetScore, true));
}

function normalizeName(value: string): string { return value.trim().replace(/\s+/g, " ").slice(0, 16); }
function validName(name: string): boolean { return name.length > 0 && name.length <= 16; }
function isOriginAllowed(origin: string | undefined, requestHost: string | undefined): boolean {
  if (!origin) return true;
  if (origins.includes(origin)) return true;
  if (!requestHost) return false;
  try { return new URL(origin).host.toLowerCase() === requestHost.toLowerCase(); }
  catch { return false; }
}
function shuffleQuestions(questions: GameQuestion[]): GameQuestion[] {
  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, ROUND_CAP);
}
function newRoomGame(room: Room) {
  return createGameState(room.targetScore, shuffleQuestions(loadQuestions(room.category)), ROUND_CAP);
}
function makeGameLeaderboard(room: Room) {
  return selectWinners(activeScorePlayers(room), room.targetScore, true);
}
function startRoomGame(room: Room) {
  const game = newRoomGame(room);
  if (!game.questions.length) return false;
  for (const player of room.players) { player.score = 0; player.correctCount = 0; player.wrongCount = 0; player.resigned = false; }
  room.lastResult = undefined;
  room.game = startGame(game, Date.now());
  room.phase = room.game.phase;
  return room.game.phase === "question";
}
function handleEvent(ws: WebSocket, event: ClientEvent) {
  if (event.type === "PING") { send(ws, { type: "PONG", serverTime: Date.now() }); return; }
  if ((event.type === "CREATE_ROOM" || event.type === "JOIN_ROOM") && socketPlayers.has(ws)) { fail(ws, "ALREADY_IN_ROOM", "Leave your current room before joining another one."); return; }
  if (event.type === "RECONNECT" && socketPlayers.has(ws)) { fail(ws, "ALREADY_IN_ROOM", "This connection already belongs to a room."); return; }
  if (event.type === "CREATE_ROOM") {
    const name = normalizeName(event.name);
    if (!validName(name)) { fail(ws, "INVALID_NAME", "Enter a name with 1 to 16 characters."); return; }
    if (!Number.isInteger(event.targetScore) || event.targetScore < 10 || event.targetScore > 100 || event.targetScore % 10 !== 0) { fail(ws, "INVALID_SETTINGS", "Choose a target score from 10 to 100, in steps of 10."); return; }
    if (!Number.isInteger(event.maxPlayers) || event.maxPlayers < 2 || event.maxPlayers > 5) { fail(ws, "INVALID_SETTINGS", "Choose a room size from 2 to 5 players."); return; }
    const code = createRoomCode();
    const room: Room = { code, masterId: "", targetScore: event.targetScore, maxPlayers: event.maxPlayers, category: (event.category || "All").trim().slice(0, 40), phase: "lobby", players: [], createdAt: Date.now(), chatMessages: [] };
    const player = createPlayer(code, name, ws);
    room.players.push(player);
    room.masterId = player.id;
    rooms.set(code, room);
    socketPlayers.set(ws, player);
    console.log(`[room] created code=${code} master=${name} target=${room.targetScore} max=${room.maxPlayers}`);
    send(ws, { type: "SESSION", token: player.token, playerId: player.id, roomCode: player.roomCode });
    sendRoom(room);
    sendChatHistory(room, ws);
    return;
  }
  if (event.type === "JOIN_ROOM") {
    const code = event.code.trim();
    const room = rooms.get(code);
    if (!/^\d{4}$/.test(code) || !room) { fail(ws, "ROOM_NOT_FOUND", "We couldn't find that room. Check the 4-digit code and try again."); return; }
    if (room.phase !== "lobby") { fail(ws, "GAME_STARTED", "That game has already started. Ask the host for a new room."); return; }
    if (room.players.length >= room.maxPlayers) { fail(ws, "ROOM_FULL", "That room is full. Ask the host to make room or start a new one."); return; }
    const name = normalizeName(event.name);
    if (!validName(name)) { fail(ws, "INVALID_NAME", "Enter a name with 1 to 16 characters."); return; }
    if (room.players.some((candidate) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { fail(ws, "NAME_TAKEN", "That name is already in this room. Try another one."); return; }
    const player = createPlayer(code, name, ws);
    room.players.push(player);
    socketPlayers.set(ws, player);
    if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = undefined; }
    console.log(`[room] joined code=${code} player=${name} players=${room.players.length}`);
    send(ws, { type: "SESSION", token: player.token, playerId: player.id, roomCode: player.roomCode });
    sendRoom(room);
    sendChatHistory(room, ws);
    return;
  }
  if (event.type === "RECONNECT") {
    const player = playersByToken.get(event.token);
    const room = player && rooms.get(player.roomCode);
    if (!player || !room || (player.reconnectTimer === undefined && !player.connected)) { fail(ws, "SESSION_EXPIRED", "That reconnect link has expired. Join the room again with its code."); return; }
    if (player.ws && player.ws !== ws && player.ws.readyState === WebSocket.OPEN) {
      send(player.ws, { type: "SESSION_MOVED", message: "This player session moved to another connection." });
      player.ws.close(4000, "Session moved to another connection");
    }
    if (player.reconnectTimer) { clearTimeout(player.reconnectTimer); player.reconnectTimer = undefined; }
    player.connected = true;
    player.ws = ws;
    socketPlayers.set(ws, player);
    send(ws, { type: "SESSION", token: player.token, playerId: player.id, roomCode: player.roomCode });
    resumeIfReady(room);
    sendCurrentState(room, player);
    sendChatHistory(room, ws);
    return;
  }

  const bound = socketPlayers.get(ws);
  const room = bound && rooms.get(bound.roomCode);
  if (!bound || !room) { fail(ws, "JOIN_FIRST", "Join or create a room before using that action."); return; }
  const player = bound;
  if (event.type === "CHAT_SEND") {
    const text = event.text.trim();
    if (!text) { fail(ws, "EMPTY_CHAT_MESSAGE", "Write a message before sending."); return; }
    let replyTo: ChatMessage["replyTo"];
    if (event.replyToId) {
      const original = room.chatMessages.find((message) => message.id === event.replyToId);
      if (!original) { fail(ws, "CHAT_REPLY_NOT_FOUND", "That message is no longer available to reply to."); return; }
      replyTo = { id: original.id, playerId: original.playerId, playerName: original.playerName, text: original.text };
    }
    const chatMessage: ChatMessage = { id: randomUUID(), playerId: player.id, playerName: player.name, text, sentAt: Date.now(), ...(replyTo ? { replyTo } : {}) };
    room.chatMessages.push(chatMessage);
    broadcastChatMessage(room, chatMessage);
    return;
  }
  if (event.type === "LEAVE") {
    if (room.masterId === player.id) {
      const notice: ServerEvent = { type: "ROOM_CLOSED", message: "The host closed the room. You have been returned home." };
      for (const member of room.players) {
        if (member.ws) {
          send(member.ws, notice);
          socketPlayers.delete(member.ws);
        }
      }
      clearRoom(room);
      return;
    }
    if (room.phase !== "lobby" && room.phase !== "gameOver" && !player.resigned) { fail(ws, "RESIGN_FIRST", "Resign from the game before leaving the room."); return; }
    if (room.phase !== "lobby" && room.phase !== "gameOver" && player.resigned) {
      player.ws = undefined;
      player.connected = false;
      player.left = true;
      playersByToken.delete(player.token);
      socketPlayers.delete(ws);
      sendRoom(room);
      return;
    }
    clearGameTimer(room);
    player.ws = undefined;
    player.connected = false;
    removePlayer(room, player);
    socketPlayers.delete(ws);
    if (room.players.length) {
      if (room.game && room.phase !== "gameOver") armTimer(room);
      pauseIfNeeded(room);
      sendRoom(room);
    }
    return;
  }
  if (event.type === "KICK") {
    if (room.masterId !== player.id || room.phase !== "lobby") { fail(ws, "NOT_ALLOWED", "Only the host can remove players from the lobby."); return; }
    const target = room.players.find((candidate) => candidate.id === event.playerId);
    if (!target || target.id === player.id) { fail(ws, "PLAYER_NOT_FOUND", "That player is no longer in the room."); return; }
    if (target.ws) { const kickedSocket = target.ws; fail(kickedSocket, "KICKED", "The host removed you from the room."); target.ws = undefined; target.connected = false; socketPlayers.delete(kickedSocket); kickedSocket.close(4002, "Removed by host"); }
    removePlayer(room, target);
    sendRoom(room);
    return;
  }
  if (event.type === "UPDATE_SETTINGS") {
    if (room.masterId !== player.id || room.phase !== "lobby") { fail(ws, "NOT_ALLOWED", "Only the host can update settings in the lobby."); return; }
    if (event.targetScore !== undefined && (!Number.isInteger(event.targetScore) || event.targetScore < 10 || event.targetScore > 100 || event.targetScore % 10 !== 0)) { fail(ws, "INVALID_SETTINGS", "Choose a target score from 10 to 100, in steps of 10."); return; }
    if (event.maxPlayers !== undefined && (!Number.isInteger(event.maxPlayers) || event.maxPlayers < 2 || event.maxPlayers > 5 || event.maxPlayers < room.players.length)) { fail(ws, "INVALID_SETTINGS", "The room size must be between 2 and 5, and cannot be smaller than the current room."); return; }
    const allowedCategories = ["All", "General Knowledge", "Science", "Technology", "Geography", "History", "Movies", "Sports", "Food", "India"];
    if (event.category !== undefined && !allowedCategories.includes(event.category)) { fail(ws, "INVALID_SETTINGS", "Choose one of the available question categories."); return; }
    if (event.targetScore === undefined && event.maxPlayers === undefined && event.category === undefined) { fail(ws, "INVALID_SETTINGS", "Choose a setting to update."); return; }
    if (event.targetScore !== undefined) room.targetScore = event.targetScore;
    if (event.maxPlayers !== undefined) room.maxPlayers = event.maxPlayers;
    if (event.category !== undefined) room.category = event.category;
    sendRoom(room);
    return;
  }
  if (event.type === "RESIGN") {
    if (room.phase === "lobby" || room.phase === "gameOver" || player.resigned) { fail(ws, "CANNOT_RESIGN", "You can only resign while a game is in progress."); return; }
    player.resigned = true;
    if (room.masterId === player.id) {
      const nextMaster = room.players.find((candidate) => candidate.id !== player.id && candidate.connected && !candidate.resigned && !candidate.left)
        ?? room.players.find((candidate) => candidate.id !== player.id && !candidate.resigned && !candidate.left);
      if (nextMaster) room.masterId = nextMaster.id;
    }
    console.log(`[game] player resigned room=${room.code} player=${player.name}`);
    if (activePlayers(room).length === 0) {
      finishGame(room, []);
      return;
    }
    if (room.game?.phase === "paused" && room.game.pausedPhase === "answering" && room.game.answererId === player.id) {
      room.game = resumeGame(room.game, Date.now());
      room.phase = room.game.phase;
    }
    if (room.game?.phase === "answering" && room.game.answererId === player.id) {
      resolveCurrentRound(room, null);
      return;
    }
    resumeIfReady(room);
    pauseIfNeeded(room);
    sendRoom(room);
    return;
  }
  if (event.type === "START_GAME") {
    if (room.masterId !== player.id) { fail(ws, "NOT_ALLOWED", "Only the host can start the game."); return; }
    if (room.phase !== "lobby") { fail(ws, "ALREADY_STARTED", "This game has already started."); return; }
    if (connectedActiveCount(room) < 2) { fail(ws, "NEED_MORE_PLAYERS", "At least two connected players are needed to start."); return; }
    try {
      if (!startRoomGame(room)) { fail(ws, "NO_QUESTIONS", "There are no questions for this category yet. Try All categories."); return; }
    } catch (error) {
      console.error("[questions] failed to load", error);
      fail(ws, "QUESTION_LOAD_FAILED", "The question list could not be loaded. Please try again later.");
      return;
    }
    console.log(`[room] started code=${room.code} players=${room.players.length}`);
    publishQuestion(room);
    return;
  }
  if (event.type === "END_GAME") {
    if (room.masterId !== player.id) { fail(ws, "NOT_ALLOWED", "Only the host can end this game."); return; }
    if (room.phase === "lobby") { fail(ws, "NOT_STARTED", "Start the game before ending it."); return; }
    finishGame(room, makeGameLeaderboard(room));
    return;
  }
  if (event.type === "PLAY_AGAIN") {
    if (room.masterId !== player.id) { fail(ws, "NOT_ALLOWED", "Only the host can restart the game."); return; }
    if (room.phase !== "gameOver") { fail(ws, "NOT_FINISHED", "Wait for the game to finish before playing again."); return; }
    clearGameTimer(room);
    room.game = undefined;
    room.lastResult = undefined;
    room.phase = "lobby";
    for (const candidate of [...room.players]) {
      if (candidate.left) removePlayer(room, candidate);
      else candidate.resigned = false;
    }
    sendRoom(room);
    return;
  }
  if (event.type === "BUZZ") {
    if (player.resigned) { fail(ws, "PLAYER_RESIGNED", "You resigned from this game and can watch from the room."); return; }
    const now = Date.now();
    const window = buzzWindows.get(player);
    if (!window || now - window.startedAt >= 2_000) buzzWindows.set(player, { startedAt: now, count: 1 });
    else if (window.count >= 8) { fail(ws, "RATE_LIMITED", "Give the buzzer a moment before trying again."); return; }
    else window.count++;
    if (!room.game || room.game.phase !== "question") {
      fail(ws, room.game?.phase === "answering" || room.game?.phase === "reveal" ? "TOO_LATE" : "BUZZ_INACTIVE", room.game?.phase === "answering" || room.game?.phase === "reveal" ? "You were too late." : "The buzzer is not active right now.");
      return;
    }
    const claimed = claimBuzz(room.game, player.id, now);
    if (!claimed) { fail(ws, "TOO_LATE", "You were too late."); return; }
    clearGameTimer(room);
    room.game = claimed;
    room.phase = claimed.phase;
    broadcastGameState(room);
    sendRoom(room);
    broadcastBuzzWon(room);
    sendOptionsToAnswerer(room);
    armTimer(room);
    console.log(`[game] buzz room=${room.code} player=${player.name} round=${room.game.round}`);
    return;
  }
  if (event.type === "SUBMIT_ANSWER") {
    if (player.resigned) { fail(ws, "PLAYER_RESIGNED", "You resigned from this game and can watch from the room."); return; }
    if (!Number.isInteger(event.optionIndex) || event.optionIndex < 0 || event.optionIndex > 3) { fail(ws, "INVALID_ANSWER", "Choose one of the four answers."); return; }
    if (!room.game || room.game.phase !== "answering" || room.game.answererId !== player.id) { fail(ws, "NOT_ANSWERER", "Only the player who buzzed in can answer."); return; }
    if (room.game.deadline !== undefined && Date.now() > room.game.deadline) {
      resolveCurrentRound(room, null);
      fail(ws, "ANSWER_TIMEOUT", "Time ran out before your answer arrived.");
      return;
    }
    resolveCurrentRound(room, event.optionIndex);
  }
}
void app.prepare().then(() => {
  const nextUpgradeHandler = app.getUpgradeHandler();
  const server = createServer((req, res) => {
    if (req.url === "/healthz") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); return; }
    void handle(req, res);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      void nextUpgradeHandler(req, socket, head).catch((error: unknown) => { console.error("[next] upgrade handler failed", error); socket.destroy(); });
      return;
    }
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, req.headers.host)) { console.warn("[ws] rejected game socket origin", { origin, host: req.headers.host }); socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
    console.log("[ws] accepted game socket", { origin, host: req.headers.host });
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let value: unknown;
      try { value = JSON.parse(raw.toString()); } catch { fail(ws, "INVALID_JSON", "That message could not be read."); return; }
      if (!validEvent(value)) { fail(ws, "INVALID_EVENT", "That action is not supported."); return; }
      handleEvent(ws, value);
    });
    ws.on("close", (code, reason) => {
      console.log("[ws] client disconnected", { code, reason: reason.toString() });
      const player = socketPlayers.get(ws);
      if (!player || player.ws !== ws) return;
      const room = rooms.get(player.roomCode);
      player.ws = undefined;
      player.connected = false;
      if (room) {
        player.reconnectTimer = setTimeout(() => {
          const currentRoom = rooms.get(player.roomCode);
          if (!currentRoom || player.connected) return;
          if (player.resigned) {
            playersByToken.delete(player.token);
            player.left = true;
            if (currentRoom.players.length) sendRoom(currentRoom);
            return;
          }
          const wasMaster = currentRoom.masterId === player.id;
          removePlayer(currentRoom, player);
          if (wasMaster && currentRoom.players.length) console.log(`[room] master ${player.name} expired; promoted=${currentRoom.players.find((candidate) => candidate.id === currentRoom.masterId)?.name}`);
          if (currentRoom.players.length) sendRoom(currentRoom);
        }, 2 * 60 * 1000);
        if (room.masterId === player.id) {
          setTimeout(() => {
            if (player.connected || rooms.get(room.code) !== room || room.masterId !== player.id) return;
            const promoted = room.players.find((candidate) => candidate.id !== player.id);
            if (promoted) console.log(`[room] master ${player.name} disconnected; ${promoted.name} will become host after reconnect grace`);
          }, 2 * 60 * 1000);
        }
        pauseIfNeeded(room);
        sendRoom(room);
      }
    });
  });
  server.listen(port, hostname, () => { console.log(`[server] BUZZ listening on http://${hostname}:${port}`); console.log(`[server] WebSocket endpoint ws://${hostname}:${port}/ws`); });
});
