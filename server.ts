import { createServer } from "node:http";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientEvent, ServerEvent } from "./types";
import { clearRoom, createPlayer, createRoomCode, getRoomSnapshot, playersByToken, removePlayer, rooms, type Player, type Room } from "./game/rooms";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const origins = (process.env.ALLOWED_ORIGIN ?? "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const socketPlayers = new WeakMap<WebSocket, Player>();

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
    case "SUBMIT_ANSWER": return typeof value.optionIndex === "number";
    case "START_GAME": case "BUZZ": case "END_GAME": case "PLAY_AGAIN": case "LEAVE": case "PING": return true;
    default: return false;
  }
}
function sendRoom(room: Room) {
  const event: ServerEvent = { type: "ROOM_STATE", room: getRoomSnapshot(room) };
  for (const player of room.players) if (player.ws) send(player.ws, event);
}
function sendSession(ws: WebSocket, player: Player) {
  send(ws, { type: "SESSION", token: player.token, playerId: player.id, roomCode: player.roomCode });
}
function findBoundPlayer(ws: WebSocket): { player: Player; room: Room } | undefined {
  const player = socketPlayers.get(ws);
  if (!player) return undefined;
  const room = rooms.get(player.roomCode);
  return room ? { player, room } : undefined;
}
function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 16);
}
function validName(name: string): boolean { return name.length > 0 && name.length <= 16; }

function handleEvent(ws: WebSocket, event: ClientEvent) {
  if (event.type === "PING") { send(ws, { type: "PONG", serverTime: Date.now() }); return; }
  if ((event.type === "CREATE_ROOM" || event.type === "JOIN_ROOM") && socketPlayers.has(ws)) {
    fail(ws, "ALREADY_IN_ROOM", "Leave your current room before joining another one.");
    return;
  }
  if (event.type === "RECONNECT" && socketPlayers.has(ws)) {
    fail(ws, "ALREADY_IN_ROOM", "This connection already belongs to a room.");
    return;
  }
  if (event.type === "CREATE_ROOM") {
    const name = normalizeName(event.name);
    if (!validName(name)) { fail(ws, "INVALID_NAME", "Enter a name with 1 to 16 characters."); return; }
    if (!Number.isInteger(event.targetScore) || event.targetScore < 10 || event.targetScore > 100 || event.targetScore % 10 !== 0) { fail(ws, "INVALID_SETTINGS", "Choose a target score from 10 to 100, in steps of 10."); return; }
    if (!Number.isInteger(event.maxPlayers) || event.maxPlayers < 2 || event.maxPlayers > 5) { fail(ws, "INVALID_SETTINGS", "Choose a room size from 2 to 5 players."); return; }
    const code = createRoomCode();
    const room: Room = { code, masterId: "", targetScore: event.targetScore, maxPlayers: event.maxPlayers, category: (event.category || "All").trim().slice(0, 40), phase: "lobby", players: [], createdAt: Date.now() };
    const player = createPlayer(code, name, ws);
    room.players.push(player);
    room.masterId = player.id;
    rooms.set(code, room);
    socketPlayers.set(ws, player);
    console.log(`[room] created code=${code} master=${name} target=${room.targetScore} max=${room.maxPlayers}`);
    sendSession(ws, player);
    sendRoom(room);
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
    if (room.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { fail(ws, "NAME_TAKEN", "That name is already in this room. Try another one."); return; }
    const player = createPlayer(code, name, ws);
    room.players.push(player);
    socketPlayers.set(ws, player);
    if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = undefined; }
    console.log(`[room] joined code=${code} player=${name} players=${room.players.length}`);
    sendSession(ws, player);
    sendRoom(room);
    return;
  }
  if (event.type === "RECONNECT") {
    const player = playersByToken.get(event.token);
    const room = player && rooms.get(player.roomCode);
    if (!player || !room || (player.reconnectTimer === undefined && !player.connected)) { fail(ws, "SESSION_EXPIRED", "That reconnect link has expired. Join the room again with its code."); return; }
    if (player.ws && player.ws !== ws && player.ws.readyState === WebSocket.OPEN) player.ws.close(4000, "Session moved to another connection");
    if (player.reconnectTimer) { clearTimeout(player.reconnectTimer); player.reconnectTimer = undefined; }
    player.connected = true;
    player.ws = ws;
    socketPlayers.set(ws, player);
    sendSession(ws, player);
    sendRoom(room);
    return;
  }
  const bound = findBoundPlayer(ws);
  if (!bound) { fail(ws, "JOIN_FIRST", "Join or create a room before using that action."); return; }
  const { player, room } = bound;
  if (event.type === "LEAVE") {
    player.ws = undefined;
    player.connected = false;
    removePlayer(room, player);
    socketPlayers.delete(ws);
    if (room.players.length) sendRoom(room);
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
  if (event.type === "START_GAME") {
    if (room.masterId !== player.id) { fail(ws, "NOT_ALLOWED", "Only the host can start the game."); return; }
    if (room.phase !== "lobby") { fail(ws, "ALREADY_STARTED", "This game has already started."); return; }
    if (room.players.filter((candidate) => candidate.connected).length < 2) { fail(ws, "NEED_MORE_PLAYERS", "At least two connected players are needed to start."); return; }
    room.phase = "question";
    console.log(`[room] started code=${room.code} players=${room.players.length}`);
    sendRoom(room);
    return;
  }
  if (event.type === "END_GAME" || event.type === "PLAY_AGAIN" || event.type === "BUZZ" || event.type === "SUBMIT_ANSWER") {
    fail(ws, "NOT_READY", "The game controls are being added in the next build stage.");
  }
}

void app.prepare().then(() => {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); return; }
    void handle(req, res);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin;
    if (req.url !== "/ws" || (origin && !origins.includes(origin))) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let value: unknown;
      try { value = JSON.parse(raw.toString()); } catch { fail(ws, "INVALID_JSON", "That message could not be read."); return; }
      if (!validEvent(value)) { fail(ws, "INVALID_EVENT", "That action is not supported."); return; }
      handleEvent(ws, value);
    });
    ws.on("close", () => {
      const player = socketPlayers.get(ws);
      if (!player || player.ws !== ws) return;
      const room = rooms.get(player.roomCode);
      player.ws = undefined;
      player.connected = false;
      if (room) {
        player.reconnectTimer = setTimeout(() => {
          const currentRoom = rooms.get(player.roomCode);
          if (!currentRoom || player.connected) return;
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
        sendRoom(room);
      }
    });
  });
  server.listen(port, hostname, () => { console.log(`[server] BUZZ listening on http://${hostname}:${port}`); console.log(`[server] WebSocket endpoint ws://${hostname}:${port}/ws`); });
});
