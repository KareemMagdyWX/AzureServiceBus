import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { IGNORED_PATTERNS, REVIEWABLE_EXTENSIONS } from "./ignorePatterns.js";

function shouldIgnore(filePath) {
  return IGNORED_PATTERNS.some(
    (p) => filePath.includes(p) || filePath.endsWith(p)
  );
}

function isReviewable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return REVIEWABLE_EXTENSIONS.includes(ext);
}

/**
 * Collects git diffs for all reviewable .NET files changed vs origin/main.
 * Returns { payload, fileCount }
 */
export function collectDiffs() {
  execSync("git fetch origin main", { stdio: "ignore" });

  const changedFiles = execSync("git diff --name-only origin/main...HEAD")
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);

  let payload = "";
  let fileCount = 0;

  for (const file of changedFiles) {
    if (shouldIgnore(file)) {
      console.log(`⏭️  Skipping: ${file}`);
      continue;
    }

    if (!isReviewable(file)) continue;

    if (!existsSync(file)) {
      console.log(`⚠️  File not found (deleted?): ${file}`);
      continue;
    }

    console.log(`✅ Reviewing: ${file}`);
    const diff = execSync(`git diff origin/main...HEAD -- "${file}"`).toString();

    payload += `\n===== FILE: ${file} =====\n${diff}\n========================\n`;
    fileCount++;
  }

  return { payload, fileCount };
}
