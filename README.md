# BUZZ

BUZZ is a real-time multiplayer multiple-choice buzzer quiz. The current build includes room creation, room joining by code or invite link, a live lobby, host controls, and reconnectable player sessions. Gameplay is the next build stage.

## Requirements

- Node.js 20.9 or newer (Node 24 is suitable)
- npm

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Install dependencies with `npm install`.
3. Start development mode with `npm run dev`.
4. Visit http://localhost:3000. The health endpoint is http://localhost:3000/healthz.
5. The WebSocket endpoint is `ws://localhost:3000/ws`.

Production commands are `npm run build` and `npm start`. The custom server uses `PORT` (default 3000) and listens on `0.0.0.0`. `ALLOWED_ORIGIN` accepts a comma-separated list of browser origins; the default is local development.

## WebSocket protocol

All client messages are JSON objects with a `type` field. The server validates the message shape and fields. Room creation, joining, reconnecting, host kick, and start are active; buzzer, answer, and full game controls arrive in the next stage.

| Direction | Event | Fields |
|---|---|---|
| Client → server | `CREATE_ROOM` | name, targetScore, maxPlayers, optional category |
| Client → server | `JOIN_ROOM` | code, name |
| Client → server | `RECONNECT` | token |
| Client → server | `START_GAME`, `BUZZ`, `END_GAME`, `PLAY_AGAIN`, `LEAVE` | type |
| Client → server | `SUBMIT_ANSWER` | optionIndex |
| Client → server | `KICK` | playerId |
| Client → server | `PING` | type |
| Server → client | `SESSION` | token, playerId, roomCode |
| Server → client | `ROOM_STATE`, `GAME_STATE`, `QUESTION`, `BUZZ_WON`, `OPTIONS`, `ROUND_RESULT`, `GAME_OVER` | typed payloads in `types.ts` |
| Server → client | `ERROR` | code, message |
| Server → client | `PONG` | serverTime |

Clients send intents only. The server owns room membership, player identity, room settings, and host permissions. It will own buzzer ordering, answers, and scores once gameplay is added.

## Phase machine

`lobby → question → answering → reveal → question`, with `paused` for reconnect waits and `gameOver` for a completed game. The pure transition function is in `game/machine.ts`; timers, scoring, and WebSocket delivery are kept outside it.

## Deployment

The planned host is Render Web Services because it supports persistent WebSocket connections and managed HTTPS/WSS. A free instance sleeps after 15 minutes without incoming HTTP or WebSocket traffic and may take about a minute to wake. Exact deployment steps will be completed with the deployment stage.
