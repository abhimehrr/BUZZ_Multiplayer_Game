import assert from "node:assert/strict";
import test from "node:test";
import { advanceQuestion, claimBuzz, createGameState, resolveRound, startGame } from "./machine";
import type { GameQuestion, ScorePlayer } from "../types";

const question: GameQuestion = {
  id: "test-001",
  category: "Test",
  difficulty: "easy",
  question: "Which option is correct?",
  options: ["A", "B", "C", "D"],
  answerIndex: 2,
};
const players: ScorePlayer[] = [
  { id: "p1", name: "One", score: 0, correctCount: 0, wrongCount: 0 },
  { id: "p2", name: "Two", score: 0, correctCount: 0, wrongCount: 0 },
];
const questionState = () => startGame(createGameState(10, [question]), 1_000);

test("the first processed buzz owns the answer and later buzzes cannot replace them", () => {
  const first = claimBuzz(questionState(), "p1", 2_000);
  assert.ok(first);
  assert.equal(first.answererId, "p1");
  assert.equal(first.phase, "answering");
  assert.equal(claimBuzz(first, "p2", 2_000), null);
});

test("a correct answer adds ten points and increments the correct count", () => {
  const answering = claimBuzz(questionState(), "p1", 2_000)!;
  const result = resolveRound(answering, players, 2, 3_000)!;
  assert.equal(result.players[0].score, 10);
  assert.equal(result.players[0].correctCount, 1);
  assert.equal(result.players[0].wrongCount, 0);
  assert.equal(result.result.correct, true);
  assert.equal(result.state.phase, "gameOver");
  assert.deepEqual(result.winners.map((winner) => winner.id), ["p1"]);
});

test("a wrong answer and answer timeout each increment wrong count without points", () => {
  const answering = claimBuzz(questionState(), "p1", 2_000);
  assert.ok(answering);
  const wrong = resolveRound(answering, players, 1, 3_000)!;
  assert.equal(wrong.players[0].score, 0);
  assert.equal(wrong.players[0].wrongCount, 1);
  assert.equal(wrong.result.correct, false);

  const timeout = resolveRound(answering, players, null, 3_000)!;
  assert.equal(timeout.players[0].wrongCount, 1);
  assert.equal(timeout.result.timedOut, true);
});

test("a no-buzz timeout reveals the answer without changing anyone's score", () => {
  const result = resolveRound(questionState(), players, null, 31_000)!;
  assert.equal(result.result.correct, null);
  assert.equal(result.result.correctAnswer, "C");
  assert.deepEqual(result.players, players);
  assert.equal(result.state.phase, "reveal");
});

test("question exhaustion selects all highest scorers as co-winners", () => {
  const oneRound = startGame(createGameState(100, [question], 1), 1_000);
  const answering = claimBuzz(oneRound, "p1", 2_000)!;
  const resolved = resolveRound(answering, players, 2, 3_000)!;
  const end = advanceQuestion(resolved.state, resolved.players, 6_000);
  assert.equal(end.state.phase, "gameOver");
  assert.deepEqual(end.winners.map((winner) => winner.id), ["p1"]);
  const tied = advanceQuestion({ ...resolved.state, phase: "reveal", targetScore: 100 }, [
    ...resolved.players,
    { id: "p3", name: "Three", score: 10, correctCount: 1, wrongCount: 0 },
  ], 6_000);
  assert.deepEqual(tied.winners.map((winner) => winner.id), ["p1", "p3"]);
});
