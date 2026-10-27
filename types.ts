/** Shared protocol: clients send intents; server owns game state. */
export type ClientEvent =
  | { type: "CREATE_ROOM"; name: string; targetScore: number; maxPlayers: number; category?: string }
  | { type: "JOIN_ROOM"; code: string; name: string }
  | { type: "RECONNECT"; token: string }
  | { type: "START_GAME" }
  | { type: "BUZZ" }
  | { type: "SUBMIT_ANSWER"; optionIndex: number }
  | { type: "KICK"; playerId: string }
  | { type: "END_GAME" }
  | { type: "PLAY_AGAIN" }
  | { type: "LEAVE" }
  | { type: "PING" };

export type ServerEvent =
  | { type: "SESSION"; token: string; playerId: string; roomCode: string }
  | { type: "ROOM_STATE"; room: RoomSnapshot }
  | { type: "GAME_STATE"; game: GameSnapshot }
  | { type: "QUESTION"; question: PublicQuestion; round: number; deadline: number }
  | { type: "BUZZ_WON"; playerId: string; playerName: string; deadline: number }
  | { type: "OPTIONS"; options: [string, string, string, string] }
  | { type: "ROUND_RESULT"; correctIndex: number; playerId?: string; correct: boolean | null }
  | { type: "GAME_OVER"; winners: string[]; leaderboard: LeaderboardEntry[] }
  | { type: "ERROR"; code: string; message: string }
  | { type: "PONG"; serverTime: number };

export type GamePhase = "lobby" | "question" | "answering" | "reveal" | "paused" | "gameOver";
export interface PlayerSnapshot { id: string; name: string; score: number; correctCount: number; wrongCount: number; connected: boolean; isMaster: boolean }
export interface RoomSnapshot { code: string; masterId: string; phase: GamePhase; targetScore: number; maxPlayers: number; category: string; players: PlayerSnapshot[] }
export interface PublicQuestion { id: string; category: string; difficulty: "easy" | "medium" | "hard"; question: string }
export interface GameSnapshot { phase: GamePhase; round: number; roundCap: number; question?: PublicQuestion; answererId?: string; deadline?: number }
export interface LeaderboardEntry { playerId: string; name: string; score: number; correctCount: number; wrongCount: number; accuracy: number }
export interface GameState { phase: GamePhase; round: number; roundCap: number; targetScore: number; questionIds: string[]; questionIndex: number; answererId?: string }
export type GameAction = { type: "START" } | { type: "QUESTION_SHOWN" } | { type: "BUZZ"; playerId: string } | { type: "ANSWER_RESOLVED" } | { type: "PAUSE" } | { type: "RESUME" } | { type: "FINISH" } | { type: "PLAY_AGAIN" };
