import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const folder = join(process.cwd(), "data", "questions");
const files = readdirSync(folder).filter((file) => file.endsWith(".json")).sort();
const ids = new Set<string>();
const normalizedQuestions = new Map<string, string>();
const categories = new Map<string, number>();
const answerDistribution = [0, 0, 0, 0];
const errors: string[] = [];
let total = 0;

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}

for (const file of files) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(folder, file), "utf8"));
  } catch (error) {
    errors.push(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    continue;
  }
  if (!Array.isArray(parsed)) {
    errors.push(`${file}: top-level value must be an array`);
    continue;
  }
  for (const [index, value] of parsed.entries()) {
    const location = `${file}[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${location}: entry must be an object`);
      continue;
    }
    const q = value as Record<string, unknown>;
    if (typeof q.id !== "string" || !q.id.trim()) errors.push(`${location}: id must not be empty`);
    else if (ids.has(q.id)) errors.push(`${location}: duplicate id ${q.id}`);
    else ids.add(q.id);
    if (typeof q.category !== "string" || !q.category.trim()) errors.push(`${location}: category must not be empty`);
    else categories.set(q.category, (categories.get(q.category) ?? 0) + 1);
    if (!["easy", "medium", "hard"].includes(String(q.difficulty))) errors.push(`${location}: difficulty must be easy, medium, or hard`);
    if (typeof q.question !== "string" || !q.question.trim()) errors.push(`${location}: question must not be empty`);
    else {
      const normalized = normalize(q.question);
      const previous = normalizedQuestions.get(normalized);
      if (previous) errors.push(`${location}: duplicate question text (also in ${previous})`);
      else normalizedQuestions.set(normalized, location);
    }
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((option) => typeof option !== "string" || !option.trim())) {
      errors.push(`${location}: options must contain exactly four non-empty strings`);
    } else {
      const options = (q.options as string[]).map(normalize);
      if (new Set(options).size !== 4) errors.push(`${location}: options must be distinct`);
    }
    if (!Number.isInteger(q.answerIndex) || Number(q.answerIndex) < 0 || Number(q.answerIndex) > 3) errors.push(`${location}: answerIndex must be an integer from 0 to 3`);
    else answerDistribution[Number(q.answerIndex)]++;
    total++;
  }
}

if (total < 1000) errors.push(`question bank must contain at least 1,000 questions; found ${total}`);
if (Math.max(...answerDistribution) - Math.min(...answerDistribution) > 1) errors.push("correct-answer positions are not evenly distributed");
console.log(`Validated ${total} question entr${total === 1 ? "y" : "ies"} across ${files.length} file(s).`);
for (const [category, count] of [...categories].sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${category}: ${count}`);
console.log(`Answer index distribution: 0=${answerDistribution[0]}, 1=${answerDistribution[1]}, 2=${answerDistribution[2]}, 3=${answerDistribution[3]}`);
if (errors.length) {
  console.error(`\nFound ${errors.length} problem(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log("Question bank validation passed.");
}
