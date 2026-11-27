import accessIcon from "../assets/office-icons/access.svg?no-inline";
import excelIcon from "../assets/office-icons/excel.svg?no-inline";
import formsIcon from "../assets/office-icons/forms.svg?no-inline";
import oneDriveIcon from "../assets/office-icons/onedrive.svg?no-inline";
import oneNoteIcon from "../assets/office-icons/onenote.svg?no-inline";
import sharePointIcon from "../assets/office-icons/sharepoint.svg?no-inline";
import teamsIcon from "../assets/office-icons/teams.svg?no-inline";

export const GRADIENTS = [
  "from-indigo-500 to-purple-600",
  "from-blue-500 to-cyan-500",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-violet-500 to-fuchsia-600",
  "from-cyan-500 to-blue-600",
  "from-sky-500 to-indigo-600",
];

export function gradientFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length];
}

export function prettyUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function hostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function faviconUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const paths = [parsed.pathname, ...parsed.searchParams.values()];
    const hasExtension = (extensions: string[]) => paths.some((path) => {
      let decoded = path;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        // Keep the original path if it contains invalid escapes.
      }
      return extensions.some((extension) => decoded.toLowerCase().endsWith(`.${extension}`));
    });

    if (hasExtension(["xls", "xlsx", "xlsm", "xlsb", "xltx", "xltm"])) return excelIcon;
    if (hasExtension(["accdb", "accde", "accdt", "mdb", "mde"])) return accessIcon;
    if (hasExtension(["one", "onetoc2"])) return oneNoteIcon;

    const isHost = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    if (isHost("forms.office.com") || isHost("forms.microsoft.com") || isHost("forms.cloud.microsoft")) return formsIcon;
    if (isHost("teams.microsoft.com") || isHost("teams.live.com") || isHost("teams.cloud.microsoft")) return teamsIcon;
    if (isHost("excel.office.com") || isHost("excel.cloud.microsoft")) return excelIcon;
    if (isHost("onenote.com") || isHost("onenote.office.com") || isHost("onenote.cloud.microsoft")) return oneNoteIcon;
    if (isHost("sharepoint.com") && /^\/:x:\//i.test(parsed.pathname)) return excelIcon;
    if (isHost("sharepoint.com") && /^\/:o:\//i.test(parsed.pathname)) return oneNoteIcon;
    if (isHost("onedrive.live.com") || isHost("1drv.ms") || host.endsWith("-my.sharepoint.com")) return oneDriveIcon;
    if (isHost("sharepoint.com")) return sharePointIcon;
  } catch {
    return null;
  }
  const host = hostname(url);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
}

export function fallbackFaviconUrl(url: string): string | null {
  const host = hostname(url);
  if (!host) return null;
  return `https://unavatar.io/${encodeURIComponent(host)}?fallback=false`;
}
