/**
 * install --skills — copy skill files into <cwd>/.claude/skills/playwright-cli-sessions/
 *
 * Makes the playwright-cli-sessions skills available to Claude Code in the
 * current project without requiring manual file copying.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function copyDir(src: string, dst: string): number {
  mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const dstPath = join(dst, entry);
    if (statSync(srcPath).isDirectory()) {
      count += copyDir(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
      count++;
    }
  }
  return count;
}

export function cmdInstall(flags: { skills: boolean }): void {
  if (!flags.skills) {
    console.log("Usage: playwright-cli-sessions install --skills");
    console.log(
      "  --skills   Copy skill files into <cwd>/.claude/skills/playwright-cli-sessions/",
    );
    return;
  }

  // Skills directory is two levels up from dist/commands/ (or src/commands/)
  // Package structure: dist/commands/install.js → ../../skills/
  const packageRoot = join(__dirname, "..", "..");
  const skillsSrc = join(packageRoot, "skills", "playwright-cli-sessions");

  if (!existsSync(skillsSrc)) {
    throw new Error(
      `Skills directory not found at ${skillsSrc}. ` +
        `This is a packaging error — please reinstall playwright-cli-sessions.`,
    );
  }

  const target = join(
    process.cwd(),
    ".claude",
    "skills",
    "playwright-cli-sessions",
  );
  const count = copyDir(skillsSrc, target);

  console.log(`✓ Installed ${count} skill file(s) to ${target}`);
  console.log(
    `  Claude Code will now have access to playwright-cli-sessions skills.`,
  );
}
