import { randomInt, randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { ChatMessage, GamePhase, GameState, PlayerSnapshot, RoomSnapshot, RoundResolution } from "../types";

export interface Player {
  id: string; token: string; name: string; roomCode: string; ws?: WebSocket;
  score: number; correctCount: number; wrongCount: number; connected: boolean; joinedAt: number; resigned: boolean; left: boolean;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}
export interface Room {
  code: string; masterId: string; targetScore: number; maxPlayers: number; category: string; phase: GamePhase;
  players: Player[]; createdAt: number; chatMessages: ChatMessage[]; game?: GameState; lastResult?: RoundResolution["result"]; gameTimer?: ReturnType<typeof setTimeout>; emptyTimer?: ReturnType<typeof setTimeout>;
}
export const rooms = new Map<string, Room>();
export const playersByToken = new Map<string, Player>();

export function createRoomCode(): string {
  for (let tries = 0; tries < 10000; tries++) {
    const code = String(randomInt(0, 10000)).padStart(4, "0");
    if (!rooms.has(code)) return code;
  }
  throw new Error("No room codes are available right now.");
}
export function createPlayer(roomCode: string, name: string, ws: WebSocket): Player {
  const player: Player = { id: randomUUID(), token: randomUUID(), name, roomCode, ws, score: 0, correctCount: 0, wrongCount: 0, connected: true, joinedAt: Date.now(), resigned: false, left: false };
  playersByToken.set(player.token, player);
  return player;
}
export function getRoomSnapshot(room: Room): RoomSnapshot {
  const players: PlayerSnapshot[] = room.players.map((p) => ({
    id: p.id, name: p.name, score: p.score, correctCount: p.correctCount, wrongCount: p.wrongCount,
    connected: p.connected, isMaster: room.masterId === p.id, resigned: p.resigned, left: p.left,
  }));
  return { code: room.code, masterId: room.masterId, phase: room.phase, targetScore: room.targetScore, maxPlayers: room.maxPlayers, category: room.category, players };
}
export function clearRoom(room: Room) {
  if (room.emptyTimer) clearTimeout(room.emptyTimer); if (room.gameTimer) clearTimeout(room.gameTimer);
  for (const player of room.players) {
    if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
    playersByToken.delete(player.token);
    if (player.ws?.readyState === WebSocket.OPEN) player.ws.close(4001, "Room closed");
  }
  rooms.delete(room.code);
}
export function removePlayer(room: Room, player: Player) {
  if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
  playersByToken.delete(player.token);
  room.players = room.players.filter((p) => p.id !== player.id);
  if (room.masterId === player.id && room.players.length) room.masterId = [...room.players].sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
  if (room.players.length === 0) {
    room.emptyTimer = setTimeout(() => clearRoom(room), 5 * 60 * 1000);
  }
}
