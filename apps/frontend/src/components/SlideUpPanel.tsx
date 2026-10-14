import { useEffect, type ReactNode } from "react";

interface SlideUpPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function SlideUpPanel({ open, onClose, title, children }: SlideUpPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full slide-up rounded-t-3xl bg-slate-900/80 backdrop-blur-2xl border-t border-white/10 shadow-[0_-8px_40px_rgba(0,0,0,0.5)] max-h-[65vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0 px-6 pt-4 pb-3 border-b border-white/5">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 border border-white/10 text-white/60 hover:text-white hover:bg-white/20 flex items-center justify-center text-lg cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
