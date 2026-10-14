---
name: console-explore-screenshots
description: "Explore the Cloudisy/PageX console UI in the browser and capture screenshots to R2. Triggers on: explore the console, browse/tour the app, take screenshot, capture page, save ss, upload screenshot to r2, screenshot the dashboard/projects/billing/settings tabs, screenshot the project detail tabs (Domains, Deploys, Builds, Files, Environment, Analytics, Performance, Usage, Settings), full-page screenshot, wrangler r2 object put."
---

# Console Explore + Screenshots to R2

Capture the Cloudisy console UI with Playwright and upload the PNGs to Cloudflare R2 via the wrangler CLI. Do it live in the browser — never fake or reconstruct the UI from code.

## Environment facts

- Console origin: `https://pagex-console.rsioex.workers.dev` (also exposed as `hss-4276.cloudisy.top` for tenant sites; the Astro marketing site has no login form — login only on the console).
- R2 buckets: `assets` (screenshot uploads) and `pagex-blobs-dev` (the console `BLOBS` binding). Upload to `assets`.
- Wrangler is already logged in (`wrangler whoami` → Account API Token). Use `--remote` on every R2 command or it silently writes to local `.wrangler/state`.
- Screenshots save under `.playwright-mcp/` (repo root, gitignored).

## Workflow

### 1. Login if needed

Navigate to the console root. If a session exists (e.g. dashboard greets a user), **log out first** (`button` for the account profile → menu → `Log out`) so you land on the real `/login` form. Fill Email + Password via `fill_form`, click `Sign In`, then wait ~3s on the dashboard and confirm the greeter username matches the intended account.

### 2. Navigate & wait

Pages load slow (5–15s). After every navigation or tab switch wait at least 6–8s before snapshotting. Routes:

| Page | URL path |
|------|----------|
| Dashboard | `/` |
| Projects | `/projects` |
| Project detail | `/projects/{id}/overview` |
| Billing | `/billing` |
| Settings | `/settings` |

Project detail `/login` or `/projects/{id}/domains` may 404 if navigated directly — tabs are **client-side** under one `/overview` URL; get `id` from the Projects page or from `GET /api/pages` (network tab).

### 3. Switch Radix tabs (critical quirk)

The project detail tabs are Radix (`role="tab"`, `tabindex=-1`). Playwright's `getByRole('tab').click()` and JS `.click()` **don't switch the tab**. Trigger the full pointer sequence instead:

```js
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const target = tabs.find(t => t.textContent.trim().toLowerCase() === '<name>');
  target.scrollIntoView({ behavior: 'instant', block: 'center' });
  const fire = (type) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, view: window }));
  fire('pointerdown'); fire('mousedown');
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  fire('pointerup');
});
```

Then wait 8s. Verify success by reading the tab's `aria-selected` — it must be `"true"` — and/or snapshot the active `tabpanel`.

Tabs in order: Overview, Domains, Deploys, Builds, Files, Environment, Analytics, Performance, Usage, Settings.

### 4. Screenshot

Use `take_screenshot` with `scale: "css"` to `.playwright-mcp/`:

- Viewport shot: filename `tab-<tab>.png` or `<page>.png`.
- Full page: `fullPage: true`, filename `full-<page>.png` or `full-tab-<tab>.png` (prefix consistently; don't mix `tab-X-full` and `full-tab-X` in one run).
- Grab a preliminary snapshot (`snapshot`) to confirm data actually loaded before shooting.

### 5. Upload to R2

Use the wrangler CLI from the repo root with `--remote`:

```bash
wrangler r2 object put assets/<name>-<YYYY-MM-DD>.png --file=.playwright-mcp/<name>.png --content-type=image/png --remote
```

Batch uploads in one `for f in ...` loop. Name objects with a date suffix (e.g. `full-dashboard-2026-10-14.png`). Confirm with `wrangler r2 object get <bucket>/<key> --remote` or list the bucket if unsure.

## Gotchas

- A stray console `404`/`403` (e.g. GitHub commit lookup 403, `/projects/{id}/domains` 404) is usually unrelated page noise — don't stop unless it blocks the tab content.
- Keep wait time generous; the Worker cold-starts frequently.
- Never overwrite a previous screenshot's local filename with a different `fullPage` mode in the same run — use distinct prefixes (`tab-` vs `full-tab-`).