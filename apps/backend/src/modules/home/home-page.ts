import type { Request, Response } from "express";
import { publicPage } from "../../utils/public-page";

const style = `
body { min-height: 100vh; min-height: 100svh; padding: 36px 24px;
  background: radial-gradient(ellipse at 90% 25%, #172b49, transparent 55%), #0b1020; }
main { max-width: 1100px; }
nav { align-items: center; margin-bottom: 72px; font-size: 14px; }
.welcome { display: grid; grid-template-columns: 1.25fr 1fr; align-items: center; gap: 48px; padding: 24px 0 72px; }
.eyebrow { display: flex; align-items: center; gap: 10px; color: #a4b8d9; font-size: 11px; font-weight: 650; letter-spacing: .16em; text-transform: uppercase; }
.eyebrow::before { content: ""; width: 24px; height: 1px; background: #709fe8; }
h1 { font-size: clamp(44px, 6.5vw, 76px); font-weight: 650; line-height: 1.06; letter-spacing: -.055em; margin: 24px 0; }
h1 span { color: #9fc3ff; }
.intro { max-width: 440px; font-size: 17px; line-height: 1.8; color: #b6c3d9; }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
.actions a { display: inline-flex; align-items: center; justify-content: center; gap: 20px; min-height: 48px; padding: 14px 20px;
  border: 1px solid #526783; border-radius: 10px; color: #e5edff; font-size: 14px; font-weight: 650; text-decoration: none; }
.actions .primary { color: #0b1930; background: #b8d3ff; border-color: #b8d3ff; }
.actions a:hover { background: #1c304d; border-color: #8faed9; }
.actions .primary:hover { background: #d3e3ff; border-color: #d3e3ff; }
.compass-art { position: relative; display: grid; place-items: center; width: min(100%, 360px); aspect-ratio: 1; justify-self: center;
  border: 1px solid #53709a40; border-radius: 50%; background: radial-gradient(circle, #3b82f61a, transparent 68%); }
.compass-art::before { content: ""; position: absolute; inset: 28px; border: 1px dashed #6b8dba40; border-radius: 50%; }
.compass-art::after { content: "N"; position: absolute; top: -8px; padding: 0 12px; background: #14223a; color: #9fb7d9; font-size: 11px; letter-spacing: .1em; }
.compass-art img { width: 68%; height: auto; position: relative; }
.recovery { display: flex; align-items: center; justify-content: space-between; gap: 24px; border-top: 1px solid #35465e; border-bottom: 1px solid #35465e; padding: 28px 0; }
.recovery h2 { margin: 0 0 6px; font-size: 17px; font-weight: 600; letter-spacing: -.02em; }
.recovery p { margin: 0; font-size: 14px; color: #aebed5; }
.recovery a { display: inline-flex; align-items: center; gap: 20px; padding: 12px 0; flex-shrink: 0; font-size: 14px; text-underline-offset: 5px; }
.recovery a:hover { color: #fff; }
footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; padding: 24px 0; color: #9bacc6; font-size: 12px; }
@media (max-width: 700px) {
  body { padding: 24px 20px; }
  nav { gap: 16px; margin-bottom: 36px; font-size: 13px; }
  nav .brand { flex-basis: 100%; margin-bottom: 8px; }
  .welcome { grid-template-columns: 1fr; gap: 36px; padding: 8px 0 40px; }
  .compass-art { width: 220px; }
  .intro { font-size: 16px; }
  .recovery { align-items: flex-start; flex-direction: column; gap: 12px; }
}
`;

export function homePage(_req: Request, res: Response): void {
  publicPage(res, "Welcome", `
<section class="welcome" aria-labelledby="welcome-heading">
  <div>
    <p class="eyebrow">Your personal command center · Backend</p>
    <h1 id="welcome-heading">A little direction.<br><span>A lot more focus.</span></h1>
    <p class="intro">Welcome to Northstar. This is the home of the services behind your everyday essentials, from notes and shortcuts to your next train.</p>
    <div class="actions">
      <a class="primary" href="/health">Check API health <span aria-hidden="true">↗</span></a>
      <a href="/lrt">Explore timetables <span aria-hidden="true">→</span></a>
    </div>
  </div>
  <div class="compass-art" aria-hidden="true"><img src="/favicon.png" width="256" height="256" alt=""></div>
</section>
<section class="recovery" aria-labelledby="recovery-heading">
  <div>
    <h2 id="recovery-heading">A fresh start, whenever you need it.</h2>
    <p>Forgot your password? Let’s get you back to your Northstar.</p>
  </div>
  <a href="/forgot-password">Recover your account <span aria-hidden="true">→</span></a>
</section>
<footer><span>Northstar · A calmer corner of your day.</span><span>Backend &amp; public tools</span></footer>`, "", style);
}
