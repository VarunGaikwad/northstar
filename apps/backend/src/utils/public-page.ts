import { randomBytes } from "node:crypto";
import type { Response } from "express";

/** All content and scripts are static source; never interpolate request data here. */
export function publicPage(res: Response, title: string, content: string, script: string): void {
  const nonce = randomBytes(18).toString("base64");
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": ["default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, "connect-src 'self'", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'"].join("; "),
  });
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Northstar</title><style nonce="${nonce}">
:root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; color: #eef2ff; background: #0b1020; }
* { box-sizing: border-box; } body { margin: 0; padding: 32px 16px; }
main { max-width: 960px; margin: auto; } nav { display: flex; flex-wrap: wrap; gap: 24px; margin-bottom: 48px; }
a { color: #c7d2fe; } h1 { font-size: clamp(28px, 5vw, 42px); margin-bottom: 12px; letter-spacing: -.03em; }
p { line-height: 1.6; color: #c4cadb; } form { display: flex; flex-wrap: wrap; align-items: end; gap: 16px; margin: 32px 0; }
label { display: grid; gap: 8px; flex: 1 1 180px; } input, select, button { font: inherit; min-height: 48px; border: 1px solid #64748b; border-radius: 8px; padding: 12px; color: #fff; background: #172139; max-width: 100%; }
button { background: #4f46e5; cursor: pointer; font-weight: 650; } button:disabled { opacity: .6; cursor: wait; }
:focus-visible { outline: 3px solid #c7d2fe; outline-offset: 3px; }
#status { min-height: 26px; } details { border-top: 1px solid #475569; padding: 16px 0; } summary { cursor: pointer; line-height: 1.7; }
.table-scroll { overflow-x: auto; } table { border-collapse: collapse; width: 100%; margin: 16px 0; } th, td { text-align: left; padding: 12px; border-bottom: 1px solid #334155; }
small { color: #c4cadb; } [hidden] { display: none !important; }
</style></head><body><main><nav aria-label="Northstar pages"><strong>✧ Northstar</strong><a href="/forgot-password">Password recovery</a><a href="/lrt">LRT timetable</a></nav>
${content}<noscript><p>Enable JavaScript to use this page.</p></noscript>
</main><script nonce="${nonce}">${script}</script></body></html>`);
}
