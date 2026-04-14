# Workflow A — Stateless testing (no login needed)

Use this for the vast majority of testing: UI checks, navigation, form flows,
API responses, public pages, etc.

## Steps

Just use `playwright-cli` directly — no session management needed:

```bash
playwright-cli open https://example.com
playwright-cli goto https://example.com/products
playwright-cli snapshot
playwright-cli close
```

No `playwright-cli-sessions` commands are needed for stateless workflows.

## When to upgrade to Workflow B

If a test that worked stateless suddenly requires login:
- The page may have added auth gating
- You may have navigated to a protected section

In that case, stop and switch to Workflow B with a saved session for that service.
