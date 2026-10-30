/** Shared wire protocol. Clients send intents; the server owns all game state. */
export type ClientEvent =
  | { type: "CREATE_ROOM"; name: string; targetScore: number; maxPlayers: number; category?: string }
  | { type: "JOIN_ROOM"; code: string; name: string }
  | { type: "RECONNECT"; token: string }
  | { type: "START_GAME" }
  | { type: "BUZZ" }
  | { type: "SUBMIT_ANSWER"; optionIndex: number }
  | { type: "KICK"; playerId: string }
  | { type: "CHAT_SEND"; text: string; replyToId?: string }
  | { type: "END_GAME" }
  | { type: "PLAY_AGAIN" }
  | { type: "LEAVE" }
  | { type: "PING" };

export type ServerEvent =
  | { type: "SESSION"; token: string; playerId: string; roomCode: string }
  | { type: "SESSION_MOVED"; message: string }
  | { type: "ROOM_STATE"; room: RoomSnapshot }
  | { type: "CHAT_HISTORY"; messages: ChatMessage[] }
  | { type: "CHAT_MESSAGE"; message: ChatMessage }
  | { type: "GAME_STATE"; game: GameSnapshot }
  | { type: "QUESTION"; question: PublicQuestion; round: number; deadline: number }
  | { type: "BUZZ_WON"; playerId: string; playerName: string; deadline: number }
  | { type: "OPTIONS"; options: [string, string, string, string] }
  | { type: "ROUND_RESULT"; correctIndex: number; correctAnswer: string; playerId?: string; selectedIndex?: number; correct: boolean | null; timedOut: boolean }
  | { type: "GAME_OVER"; winners: string[]; leaderboard: LeaderboardEntry[] }
  | { type: "ERROR"; code: string; message: string }
  | { type: "PONG"; serverTime: number };

export type GamePhase = "lobby" | "question" | "answering" | "reveal" | "paused" | "gameOver";
export interface PlayerSnapshot { id: string; name: string; score: number; correctCount: number; wrongCount: number; connected: boolean; isMaster: boolean }
export interface RoomSnapshot { code: string; masterId: string; phase: GamePhase; targetScore: number; maxPlayers: number; category: string; players: PlayerSnapshot[] }
export interface ChatMessage { id: string; playerId: string; playerName: string; text: string; sentAt: number; replyTo?: { id: string; playerId: string; playerName: string; text: string } }
export interface PublicQuestion { id: string; category: string; difficulty: "easy" | "medium" | "hard"; question: string }
export interface GameQuestion extends PublicQuestion { options: [string, string, string, string]; answerIndex: number }
export interface GameSnapshot { phase: GamePhase; round: number; roundCap: number; question?: PublicQuestion; answererId?: string; deadline?: number }
export interface LeaderboardEntry { playerId: string; name: string; score: number; correctCount: number; wrongCount: number; accuracy: number }
export interface ScorePlayer { id: string; name: string; score: number; correctCount: number; wrongCount: number }
export interface GameState {
  phase: GamePhase;
  round: number;
  roundCap: number;
  targetScore: number;
  questions: GameQuestion[];
  questionIndex: number;
  currentQuestion?: GameQuestion;
  answererId?: string;
  deadline?: number;
  pausedPhase?: "question" | "answering";
  remainingMs?: number;
}
export interface RoundResolution {
  state: GameState;
  players: ScorePlayer[];
  result: { correctIndex: number; correctAnswer: string; playerId?: string; selectedIndex?: number; correct: boolean | null; timedOut: boolean };
  winners: ScorePlayer[];
}
