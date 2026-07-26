/**
 * Migrate Home folder favlinks into Northstar via the REST API.
 *
 * Usage:
 *   node scripts/migrate_home_links.js
 *
 * Optional env overrides:
 *   API_BASE=http://localhost:3000
 *   ACCESS_TOKEN=<jwt>
 */

const API_BASE = process.env.API_BASE ?? "http://localhost:3000";
const TOKEN =
  process.env.ACCESS_TOKEN ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbXJ6cjJidXUwMDAwaWtwcXg5eDFranAwIiwiZW1haWwiOiJnYWlrd2FkdmFydW4yM0BnbWFpbC5jb20iLCJyb2xlIjoiVVNFUiIsImlhdCI6MTc4NDk0NjUwNywiZXhwIjoxNzg1NTUxMzA3fQ.YRAhmr0uV0Nvqn2a0nbIFN1HJFon0-ttIn-1e_fKuGg";

const workLinks = [
  { title: "Anki", url: "https://ankiweb.net/decks" },
  { title: "ChatGPT", url: "https://chatgpt.com/?temporary-chat=true" },
  {
    title: "Portfolio",
    url: "https://portfolio-drab-nine-70.vercel.app/#about"
  },
  {
    title: "SAP BAS",
    url: "https://5242e50atrial.us10cf.trial.applicationstudio.cloud.sap/index.html"
  },
  { title: "NHK EASY", url: "https://news.web.nhk/news/easy/" },
  {
    title: "SAP Trial",
    url: "https://cockpit.hanatrial.ondemand.com/trial/#/globalaccount/d5be1436-c9f6-4a49-97b3-0284a1418379/accountModel&//?section=SubaccountsSection&view=TilesView"
  },
  { title: "My Github", url: "https://github.com/VarunGaikwad" },
  {
    title: "Scenic MongoDB",
    url: "https://cloud.mongodb.com/v2/69758b2af6fb7877d5818f89#/explorer/69758b3b143e9fd287e3136c"
  },
  {
    title: "Scenic Vercel",
    url: "https://vercel.com/varun-gaikwads-projects/scenic-start-node"
  },
  {
    title: "Scenic Admin",
    url: "https://scenic-start-node-ten.vercel.app/admin/"
  },
  { title: "Resize Image", url: "https://image-resizer-x5ow.onrender.com/" },
  {
    title: "Wise",
    url: "https://wise.com/home?adgroupid=161278434847&campaignid=20934525307&device=c&gad_campaignid=20934525307&gad_source=1&gbraid=0AAAAADqE2bD1qmo5JPzfIX_ytjO2N_vrF&gclid=CjwKCAiAncvMBhBEEiwA9GU_fqS5xrfs4k1L_yNywnWgAwhiRbtlgjmj-hduXiuA9-z6mgsM0XfoRhoCgoAQAvD_BwE&keyword=wise&lang=en&matchtype=e&userlocation=9174190&utm_campaign=20934525307___161278434847&utm_source=google"
  },
  { title: "FireStudio", url: "https://studio.firebase.google.com/" },
  { title: "YouTube", url: "https://www.youtube.com/" },
  {
    title: "Figma Design",
    url: "https://www.figma.com/design/wPHQWZ6AcCmfxYlaQYs9xw/Finance-Management-Mobile-App-UI-UX-Kit-for-Budget-Tracker-Financial-Prototype-Design--Community-?node-id=7020-3430&p=f&t=fy1Kg38Se6LOEDa0-0"
  },
  {
    title: "Limit - Smart Budget & Expense Tracker",
    url: "https://limit-rust.vercel.app/dashboard"
  },
  { title: "TEPCO", url: "https://www.app.kurashi.tepco.co.jp/" },
  { title: "TokyoGas", url: "https://members.tokyo-gas.co.jp/top" },
  {
    title: "OpenClaw BAS",
    url: "https://48e01514trial.us10cf.trial.applicationstudio.cloud.sap/index.html?folder=/home/user/.openclaw#ws-jej7p"
  },
  {
    title: "Utsunomiya City Refund",
    url: "https://miya-ouenkyufukin.city-portal.jp/citizen?id=csp_index_bbs_2"
  },
  { title: "Omiai", url: "https://www.omiai-jp.com/search" },
  { title: "Gravity", url: "https://www.gravity.place/allstarlist" }
];

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) {
    const msg = data?.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data.data ?? data;
}

async function ensureHomeFolder() {
  const folders = await api("GET", "/api/folders");
  const existing = folders.find((f) => f.name === "Home" && f.parentId == null);
  if (existing) {
    console.log("Using existing Home folder:", existing.id);
    return existing.id;
  }

  const created = await api("POST", "/api/folders", { name: "Home" });
  console.log("Created Home folder:", created.id);
  return created.id;
}

async function migrateHomeLinks() {
  console.log(`API: ${API_BASE}`);
  const homeFolderId = await ensureHomeFolder();

  const results = [];

  for (const link of workLinks) {
    try {
      const data = await api("POST", "/api/favlinks", {
        title: link.title,
        url: link.url,
        folderId: homeFolderId
      });

      results.push({ title: link.title, success: true, data });
      console.log("OK", link.title);
    } catch (error) {
      results.push({ title: link.title, success: false, error: error.message });
      console.error("FAIL", link.title, error.message);
    }
  }

  const ok = results.filter((r) => r.success).length;
  const fail = results.length - ok;
  console.log(`\nDone: ${ok} ok, ${fail} failed (total ${results.length})`);
  return results;
}

migrateHomeLinks().catch((err) => {
  console.error("Migration aborted:", err.message);
  process.exit(1);
});
