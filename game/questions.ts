import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameQuestion } from "../types";

function isQuestion(value: unknown): value is GameQuestion {
  if (!value || typeof value !== "object") return false;
  const q = value as Record<string, unknown>;
  return typeof q.id === "string" && q.id.length > 0
    && typeof q.category === "string" && q.category.length > 0
    && ["easy", "medium", "hard"].includes(String(q.difficulty))
    && typeof q.question === "string" && q.question.trim().length > 0
    && Array.isArray(q.options) && q.options.length === 4
    && q.options.every((option) => typeof option === "string" && option.trim().length > 0)
    && new Set(q.options).size === 4
    && Number.isInteger(q.answerIndex) && Number(q.answerIndex) >= 0 && Number(q.answerIndex) <= 3;
}

export function loadQuestions(category = "All"): GameQuestion[] {
  const folder = join(process.cwd(), "data", "questions");
  const files = readdirSync(folder).filter((file) => file.endsWith(".json")).sort();
  const all: GameQuestion[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const parsed: unknown = JSON.parse(readFileSync(join(folder, file), "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`Question file ${file} must contain an array.`);
    for (const question of parsed) {
      if (!isQuestion(question)) throw new Error(`Invalid question entry in ${file}.`);
      if (ids.has(question.id)) throw new Error(`Duplicate question id: ${question.id}`);
      ids.add(question.id);
      if (category === "All" || question.category === category) all.push(question);
    }
  }
  return all;
}
