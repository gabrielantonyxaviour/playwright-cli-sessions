# Workflow C — First-time login setup

Use this workflow ONLY when you need to establish a new saved login state
that doesn't exist yet. For routine testing, use Workflow B (restore saved).

## Steps

1. **Open a browser session** with a named session handle:
   ```bash
   playwright-cli -s=<name> open https://<service-url>
   ```

2. **Log in manually** in the browser window that opens.
   - For Google: complete 2FA if prompted
   - For GitHub: use password + OTP or passkey
   - For services with CAPTCHA: complete it manually

3. **Save the authenticated state**:
   ```bash
   playwright-cli-sessions save <name>
   ```
   This shells out to `playwright-cli -s=<name> state-save`, reads the
   resulting storageState, runs service auto-detection, and writes
   `~/.playwright-sessions/<name>.json`.

4. **Verify the save**:
   ```bash
   playwright-cli-sessions list
   playwright-cli-sessions probe <name>
   ```
   You should see `[LIVE, probed Xm ago]` for the services you logged into.

## Rules

- A saved session name should describe the account/context, not the task:
  `gabriel-platforms`, `gabriel-socials-comms`, `rax-apps` — not `test-session-1`.
- Never overwrite a production session from a cloned/throwaway session unless
  you've verified the auth is still good.
- The saved file contains cookies — keep `~/.playwright-sessions/` out of git.
