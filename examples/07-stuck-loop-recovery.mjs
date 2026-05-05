/**
 * 07 — When the CLI prints `STUCK LOOP DETECTED`, do this.
 *
 * The CLI watches the `.usage-log.jsonl` (v0.10.0+) and prints a warning
 * when an agent session has run the same command ≥3 times in 5 minutes
 * with the same exit code. The warning is advisory — the command still
 * runs — but a fourth blind retry is the wrong move.
 *
 * This example is a meta-script: instead of doing browser work, it shows
 * the diagnostic ladder you'd run when you see the warning. Save it,
 * read it, internalize the order: status → tabs → screenshot → think.
 *
 * Run:
 *   playwright-cli-sessions exec ./07-stuck-loop-recovery.mjs
 *
 * (It just prints the ladder. The point is the SHAPE.)
 */
export async function run() {
  const ladder = [
    "1. browser status            — am I attached? Is the host the one I expect?",
    "2. browser tabs list         — what's actually open?",
    "3. screenshot <url> --allow-http-error  — what does the page render?",
    "4. snapshot <url>            — is there an auth wall, CAPTCHA, error page?",
    "5. Read the failure's `next steps:` block — it's tailored to the code.",
    "6. Stop. Fix the root cause OR file `report \"<what you tried>\"`.",
  ];
  return {
    rule: "Time is the user's most valuable currency. Don't loop blind.",
    ladder,
    budget: {
      twoStrikes: "Same error twice → no third cosmetic retry.",
      fiveMinutes: "Single browser path > 5 min → status update to user.",
      tenCommands: "10 invocations on same task → forced `report` call.",
      controlLost: "Exit 21 (PCS_BROWSER_CONTROL_LOST) → restart once, retry once, then surface.",
    },
  };
}
