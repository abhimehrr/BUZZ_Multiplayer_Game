import type { GameQuestion, GameState, RoundResolution, ScorePlayer } from "../types";

export const QUESTION_TIME_MS = 30_000;
export const ANSWER_TIME_MS = 15_000;
export const REVEAL_TIME_MS = 3_000;
export const ROUND_CAP = 30;

export function createGameState(targetScore: number, questions: GameQuestion[], roundCap = ROUND_CAP): GameState {
  return { phase: "lobby", round: 0, roundCap, targetScore, questions, questionIndex: 0 };
}

export function startGame(state: GameState, now: number): GameState {
  const question = state.questions[0];
  if (state.phase !== "lobby" || !question) return { ...state, phase: "gameOver" };
  return { ...state, phase: "question", round: 1, questionIndex: 0, currentQuestion: question, deadline: now + QUESTION_TIME_MS, answererId: undefined };
}

export function claimBuzz(state: GameState, playerId: string, now: number): GameState | null {
  if (state.phase !== "question" || !state.currentQuestion || state.deadline === undefined || now > state.deadline) return null;
  return { ...state, phase: "answering", answererId: playerId, deadline: now + ANSWER_TIME_MS };
}

export function resolveRound(state: GameState, players: ScorePlayer[], optionIndex: number | null, now: number): RoundResolution | null {
  const question = state.currentQuestion;
  if (!question || (state.phase !== "question" && state.phase !== "answering")) return null;
  const answererId = state.phase === "answering" ? state.answererId : undefined;
  let correct: boolean | null = null;
  let timedOut = false;
  let selectedIndex: number | undefined;
  let updated = players;
  if (answererId) {
    timedOut = optionIndex === null;
    if (optionIndex !== null) selectedIndex = optionIndex;
    correct = optionIndex === question.answerIndex;
    updated = players.map((player) => player.id !== answererId ? player : correct
      ? { ...player, score: player.score + 10, correctCount: player.correctCount + 1 }
      : { ...player, wrongCount: player.wrongCount + 1 });
  }
  const winners = selectWinners(updated, state.targetScore, false);
  const gameState: GameState = {
    ...state,
    phase: winners.length ? "gameOver" : "reveal",
    deadline: winners.length ? undefined : now + REVEAL_TIME_MS,
    answererId,
  };
  return {
    state: gameState,
    players: updated,
    result: { correctIndex: question.answerIndex, correctAnswer: question.options[question.answerIndex], playerId: answererId, selectedIndex, correct, timedOut },
    winners,
  };
}

export function advanceQuestion(state: GameState, players: ScorePlayer[], now: number): { state: GameState; winners: ScorePlayer[] } {
  if (state.phase !== "reveal") return { state, winners: [] };
  const nextIndex = state.questionIndex + 1;
  if (nextIndex >= state.questions.length || nextIndex >= state.roundCap) {
    return { state: { ...state, phase: "gameOver", deadline: undefined, answererId: undefined }, winners: selectWinners(players, state.targetScore, true) };
  }
  return {
    state: { ...state, phase: "question", round: state.round + 1, questionIndex: nextIndex, currentQuestion: state.questions[nextIndex], answererId: undefined, deadline: now + QUESTION_TIME_MS },
    winners: [],
  };
}

export function pauseGame(state: GameState, now: number): GameState {
  if ((state.phase !== "question" && state.phase !== "answering") || state.deadline === undefined) return state;
  return { ...state, pausedPhase: state.phase, remainingMs: Math.max(0, state.deadline - now), phase: "paused", deadline: undefined };
}

export function resumeGame(state: GameState, now: number): GameState {
  if (state.phase !== "paused" || !state.pausedPhase) return state;
  return { ...state, phase: state.pausedPhase, deadline: now + (state.remainingMs ?? 0), pausedPhase: undefined, remainingMs: undefined };
}

export function selectWinners(players: ScorePlayer[], targetScore: number, exhausted: boolean): ScorePlayer[] {
  if (players.length === 0) return [];
  const qualifying = players.filter((player) => player.score >= targetScore);
  if (qualifying.length) {
    const winningScore = Math.min(...qualifying.map((player) => player.score));
    return qualifying.filter((player) => player.score === winningScore);
  }
  if (!exhausted) return [];
  const highScore = Math.max(...players.map((player) => player.score));
  return players.filter((player) => player.score === highScore);
}
