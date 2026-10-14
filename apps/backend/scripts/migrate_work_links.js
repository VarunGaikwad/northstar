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
  {
    title: "Cloud Campus",
    url: "https://ccampus.org/learners/Portal/"
  },
  {
    title: "ReTOMOS-VER",
    url: "https://rtmsver.jpn.mds.honda.com/p/HOME"
  },
  {
    title: "Honda IC Card Transaction",
    url: "https://biz.hm.jp.honda.com/mtl10/logon.do"
  },
  {
    title: "Honda Udemy",
    url: "https://hondajp.udemy.com/organization/home/"
  },
  {
    title: "TeamCenter PRD",
    url: "https://sk.jp.hondaweb.com/rtms_tc_prd2/#/showHome"
  },
  {
    title: "TeamCenter-DEV",
    url: "https://dev.jp.hondaweb.com/rtms_tc_ver2/#/showHome"
  },
  {
    title: "Honda PC Log Alert",
    url: "http://hm-hr01.jpn.mds.honda.com/pclog/a1/top/index.php"
  },
  {
    title: "Leave Tracker",
    url: "http://prd-a-itboap01.jpn.mds.honda.com/Saku_ZaitakuShien/"
  },
  {
    title: "Tochigi Portal",
    url: "https://globalsps.mds.honda.com/apps/hgtportal/SitePages/home.aspx"
  },
  {
    title: "Global Honda Portal",
    url: "https://globalhonda.sharepoint.com/sites/jphm100367/SitePages/Home.aspx"
  },
  {
    title: "ReTOMOS Portal",
    url: "https://globalhonda.sharepoint.com/sites/jphm104831/SitePages/Home.aspx"
  },
  {
    title: "GITSP",
    url: "https://globalhonda.sharepoint.com/sites/jphm100055/SitePages/JP_GITSP_About.aspx"
  },
  {
    title: "Login/Logout",
    url: "https://jp.hondaweb.com/g_jik_p401prd1/jkc-web/application/html/SIDPC014/SIDPC014/"
  },
  {
    title: "ReTOMOS Issue Tracker",
    url: "https://globalhonda.sharepoint.com/sites/jphgt105055/Lists/ReTOMOS_ver10/view3.aspx"
  },
  {
    title: "ReTOMOS Manual",
    url: "https://globalhonda.sharepoint.com/sites/jphm104831/SitePages/%E3%83%9E%E3%83%8B%E3%83%A5%E3%82%A2%E3%83%AB.aspx"
  },
  {
    title: "Gyro",
    url: "https://gyro.honda.co.jp/vdesk/webtop.eui?z=/Common/HM01_Split_na_res&webtop=/Common/webtop_na&webtop_type=webtop_na_only"
  },
  {
    title: "Japanese Meeting Translation",
    url: "https://globalhonda-my.sharepoint.com/:w:/r/personal/j0986978_jpn_mds_honda_com/Documents/Translation/Translator.docx?d=w4e97f59fd164456b898d9e98b40a571a&csf=1&web=1&e=9wRh6Z"
  },
  {
    title: "Honda DG COLLAB SITE",
    url: "https://globalhonda.sharepoint.com/sites/jphgt103879/SitePages/%E5%8F%96%E5%BC%95%E5%85%88%E5%85%B1%E5%89%B5%E3%83%98%E3%83%AB%E3%83%97%E3%82%B5%E3%82%A4%E3%83%88---Business-Partner-Co-Creation-Help-Site.aspx"
  },
  {
    title: "VMWare",
    url: "https://prd-vc-s3101b.jpn.mds.honda.com/ui/app/folder;nav=h/urn:vmomi:Folder:group-d1:ffdd7614-b2ce-401a-8062-c1930dc19b4d/summary"
  },
  {
    title: "Release Document",
    url: "https://globalhonda.sharepoint.com/sites/gjp02460/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fgjp02460%2FShared%20Documents%2F%E9%81%A9%E7%94%A8%EF%BC%94%2F12%5F%E8%AA%B2%E9%A1%8C%E7%AE%A1%E7%90%86%2F11%5F%E3%83%AA%E3%83%AA%E3%83%BC%E3%82%B9%E9%A0%85%E7%9B%AE&viewid=4afed60f%2D2713%2D4585%2Dbddb%2D54034d132942&csf=1&web=1&e=LX7xrS&CID=b84bae69%2D30de%2D4bf0%2D9743%2D2fad07365bfa&FolderCTID=0x012000E90CE8C5FDFE6C45A43A8920370D0917"
  },
  {
    title: "AWS ReTOMOS",
    url: "https://d-95670634a5.awsapps.com/start/#/?tab=accounts"
  },
  {
    title: "ReTOMOS-PRD",
    url: "https://rtmsprd.jpn.mds.honda.com/index.html"
  },
  {
    title: "Honda Health Portal",
    url: "https://honda.hmneo.jp/HM-neo/MonshinTouroku/Action"
  },
  {
    title: "Loop",
    url: "https://loop.cloud.microsoft/p/eyJ3Ijp7InUiOiJodHRwczovL2dsb2JhbGhvbmRhLnNoYXJlcG9pbnQuY29tLz9uYXY9Y3owbE1rWW1aRDFpSVhwNFNpMVZUVzU2TkZWWFQwbFBObTFvU0VaMU4wdG1SVmxhT1ZCUllsWkhhR2szV1RCM1NtRnZiSHBxUldWeFF6Rm5UVnBTV21oMVVVOUVkRE14VDBZbVpqMHdNVk0wUTFCRVFWQk5TalJETmpNMVZUTlRWa0ZKUWxkQ1JEVkNSbGhSUlZsUUptTTlKbVpzZFdsa1BURSUzRCIsInIiOmZhbHNlfSwicCI6eyJ1IjoiaHR0cHM6Ly9nbG9iYWxob25kYS5zaGFyZXBvaW50LmNvbS86Zmw6L3IvY29udGVudHN0b3JhZ2UvQ1NQXzUwN2UxMmNmLWYzYzktNDVlMS04ZTIwLWVlYTY4NDcxNmVlYy8lRTMlODMlODklRTMlODIlQUQlRTMlODMlQTUlRTMlODMlQTElRTMlODMlQjMlRTMlODMlODglMjAlRTMlODMlQTklRTMlODIlQTQlRTMlODMlOTYlRTMlODMlQTklRTMlODMlQUEvTG9vcEFwcERhdGEvVW50aXRsZWQlMjAxLmxvb3A%2FZD13ZGEyMTJhMDA2YjEwNDY1YWI2YTNkNzJhYTU4YjZiZDkmY3NmPTEmd2ViPTEmbmF2PWN6MGxNa1pqYjI1MFpXNTBjM1J2Y21GblpTVXlSa05UVUY4MU1EZGxNVEpqWmkxbU0yTTVMVFExWlRFdE9HVXlNQzFsWldFMk9EUTNNVFpsWldNbVpEMWlJWHA0U2kxVlRXNTZORlZYVDBsUE5tMW9TRVoxTjB0bVJWbGFPVkJSWWxaSGFHazNXVEIzU21GdmJIcHFSV1Z4UXpGblRWcFNXbWgxVVU5RWRETXhUMFltWmowd01WTTBRMUJFUVVsQlJrbFJOVlZGUkV4TVNrUk1Ua2syV0VaTFUxbFhNalphSm1NOUpUSkdKbVpzZFdsa1BURW1ZVDFNYjI5d1FYQndKbkE5SlRRd1pteDFhV1I0SlRKR2JHOXZjQzF3WVdkbExXTnZiblJoYVc1bGNpWjRQU1UzUWlVeU1uY2xNaklsTTBFbE1qSlVNRkpVVlVoNGJtSkhPV2xaVjNodllqSTFhMWxUTlhwaFIwWjVXbGhDZG1GWE5UQk1iVTUyWWxoNGFVbFljRFJUYVRGV1ZGYzFOazVHVmxoVU1HeFFUbTB4YjFORldqRk9NSFJ0VWxac1lVOVdRbEpaYkZwSVlVZHJNMWRVUWpOVGJVWjJZa2h3Y1ZKWFZuaFJla1p1VkZad1UxZHRhREZWVlRsRlpFUk5lRlF3V2poTlJFWlVUa1ZPVVZKRlJsRlVWVzh3VVhwWmVrNVdWWHBWTVZwQ1UxVktXRkZyVVRGUmExcFpWVlZXV2xWQkpUTkVKVE5FSlRJeUpUSkRKVEl5YVNVeU1pVXpRU1V5TWprNU9EWXhaV0k1TFdVM09HWXROR1F6WmkwNU5HTTJMV0ZpWkRBd1lXTmhOelEwWmlVeU1pVTNSQSUzRCUzRCIsInIiOmZhbHNlfSwiaSI6eyJpIjoiOTk4NjFlYjktZTc4Zi00ZDNmLTk0YzYtYWJkMDBhY2E3NDRmIn19"
  },
  {
    title: "Azure Repo",
    url: "https://dev.azure.com/ReTOMOS-Remake/_git/ReTOMOS_Remake"
  },
  {
    title: "RedMine",
    url: "http://10.213.13.133/projects/retomos_remake"
  },
  {
    title: "Honda Questetra",
    url: "https://honda.questetra.net/"
  },
  {
    title: "ES4 Excel Overtime",
    url: "https://globalhonda.sharepoint.com/:x:/r/sites/jphgt102870/_layouts/15/Doc.aspx?sourcedoc=%7B21B332E5-B84F-4382-AABE-6A98C5951735%7D&file=%E3%80%90%E5%9B%9B%E8%BC%AA%E7%94%9F%E7%94%A3ES%E8%AA%B2%E3%80%91%E7%A0%94%E7%A9%B6%E9%96%8B%E7%99%BA%E9%81%A9%E7%94%A8%E9%99%A4%E5%A4%96%20%E6%9C%88%E5%BA%A6%E3%83%BB%E5%B9%B4%E6%9E%A0%E8%B6%85%E9%81%8E%E5%8D%94%E8%AD%B0.xlsx&action=default&mobileredirect=true&CID=b76bcd88-7bab-7dc6-3a78-8af15a16f064"
  },
  {
    title: "Grafana",
    url: "https://mx-monitor-prd.jpn.mds.honda.com/grafana/?orgId=1"
  },
  {
    title: "ReTOMOS Supporting App Portal",
    url: "https://globalhonda.sharepoint.com/sites/jphgt105055/SitePages/Home.aspx"
  },
  {
    title: "SuccessFactor",
    url: "https://performancemanager4.successfactors.com/sf/start?_s.crb=P7dE5MB4ZrW0d7rBkMutHb8IuUaJMzD9QnAw0bp2fjE%253d"
  },
  {
    title: "Login/Logout (Direct)",
    url: "https://jp.hondaweb.com/g_jik_p401prd1/jkc-web/application/html/SIDPC051/SIDPC051/"
  },
  {
    title: "Meeting Translation",
    url: "https://globalhonda-my.sharepoint.com/:w:/r/personal/j0986978_jpn_mds_honda_com/_layouts/15/Doc.aspx?sourcedoc=%7B4E97F59F-D164-456B-898D-9E98B40A571A%7D&file=Translator.docx&action=default&mobileredirect=true&DefaultItemOpen=1"
  },
  {
    title: "Honda Teams",
    url: "https://teams.microsoft.com/v2/"
  },
  {
    title: "AOAI Internal Portal",
    url: "http://localhost:3001/"
  }
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
  const existing = folders.find((f) => f.name === "Work" && f.parentId == null);
  if (existing) {
    console.log("Using existing Work folder:", existing.id);
    return existing.id;
  }

  const created = await api("POST", "/api/folders", { name: "Work" });
  console.log("Created Work folder:", created.id);
  return created.id;
}

async function migrateWorkLinks() {
  console.log(`API: ${API_BASE}`);
  const workFolderId = await ensureHomeFolder();

  const results = [];

  for (const link of workLinks) {
    try {
      const data = await api("POST", "/api/favlinks", {
        title: link.title,
        url: link.url,
        folderId: workFolderId
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

migrateWorkLinks().catch((err) => {
  console.error("Migration aborted:", err.message);
  process.exit(1);
});
