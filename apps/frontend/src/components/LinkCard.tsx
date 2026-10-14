import { useState } from "react";
import { Pencil, Trash2, ExternalLink, Copy, Check } from "lucide-react";
import type { FavLink } from "../types";
import { gradientFor, prettyUrl, faviconUrl, fallbackFaviconUrl } from "../utils/gradients";
import { IconButton } from "./ui";

interface LinkCardProps {
  link: FavLink;
  onEdit: (link: FavLink) => void;
  onDelete: (link: FavLink) => void;
  viewMode?: "grid" | "list";
}

export function LinkCard({ link, onEdit, onDelete, viewMode = "grid" }: LinkCardProps) {
  const initial = (link.title || "?").trim().charAt(0).toUpperCase();
  const primaryIcon = faviconUrl(link.url);
  const secondaryIcon = fallbackFaviconUrl(link.url);
  
  const [iconSrc, setIconSrc] = useState<string | null>(primaryIcon);
  const [iconFailed, setIconFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleIconError = () => {
    if (iconSrc === primaryIcon && secondaryIcon) {
      setIconSrc(secondaryIcon);
    } else {
      setIconFailed(true);
    }
  };

  const copyToClipboard = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const showFavicon = iconSrc && !iconFailed;

  if (viewMode === "list") {
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.05] border border-white/10 text-white transition-all duration-200 hover:bg-white/[0.12] hover:border-white/20 hover:shadow-lg"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradientFor(
              link.title
            )} flex items-center justify-center text-sm font-bold shadow-md shrink-0 p-1`}
          >
            {showFavicon ? (
              <img
                src={iconSrc}
                alt=""
                className="w-full h-full object-contain rounded-md"
                onError={handleIconError}
              />
            ) : (
              <span className="text-white drop-shadow">{initial}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate text-white/95 group-hover:text-indigo-300 transition-colors">
              {link.title}
            </div>
            <div className="text-xs text-white/40 truncate font-mono">
              {prettyUrl(link.url)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
          <IconButton
            icon={copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            label="Copy URL"
            variant="ghost"
            size="sm"
            onClick={copyToClipboard}
          />
          <IconButton
            icon={<Pencil className="w-3.5 h-3.5" />}
            label={`Edit ${link.title}`}
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit(link);
            }}
          />
          <IconButton
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label={`Delete ${link.title}`}
            variant="danger"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(link);
            }}
          />
        </div>
      </a>
    );
  }

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col items-center text-center p-4 rounded-2xl bg-white/[0.06] border border-white/12 backdrop-blur-xl text-white transition-all duration-200 hover:-translate-y-1 hover:bg-white/[0.14] hover:border-indigo-400/50 hover:shadow-[0_12px_32px_rgba(0,0,0,0.4),0_0_24px_rgba(129,140,248,0.2)]"
    >
      {/* Action Menu (Top Right Hover Overlay) */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
        <IconButton
          icon={<Pencil className="w-3 h-3" />}
          label={`Edit ${link.title}`}
          variant="glass"
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEdit(link);
          }}
        />
        <IconButton
          icon={<Trash2 className="w-3 h-3" />}
          label={`Delete ${link.title}`}
          variant="danger"
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(link);
          }}
        />
      </div>

      {/* Speed Dial Icon Container */}
      <div className="relative mb-3 mt-1">
        <div
          className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${gradientFor(
            link.title
          )} p-2.5 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-108 group-hover:shadow-indigo-500/40 transition-all duration-300 relative z-0`}
        >
          {showFavicon ? (
            <div className="w-full h-full rounded-xl bg-slate-950/40 backdrop-blur-md p-1.5 flex items-center justify-center border border-white/20">
              <img
                src={iconSrc}
                alt=""
                className="w-full h-full object-contain drop-shadow"
                onError={handleIconError}
              />
            </div>
          ) : (
            <span className="text-2xl font-black text-white drop-shadow">{initial}</span>
          )}
        </div>
      </div>

      {/* Title & Hostname */}
      <div className="w-full">
        <div className="flex items-center justify-center gap-1">
          <h4 className="font-bold text-sm text-white/95 truncate group-hover:text-indigo-300 transition-colors max-w-[120px]">
            {link.title}
          </h4>
          <ExternalLink className="w-3 h-3 text-white/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </div>
        <p className="text-[11px] text-white/50 truncate font-mono mt-0.5 max-w-[130px] mx-auto">
          {prettyUrl(link.url)}
        </p>
      </div>
    </a>
  );
}
