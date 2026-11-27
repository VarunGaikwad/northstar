import React, { useEffect } from "react";
import { X } from "lucide-react";
import { IconButton } from "./ui";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

export function Drawer({ open, onClose, title, children, icon }: DrawerProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      className="fixed inset-0 z-50 flex justify-end overflow-hidden"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/70"
        onClick={onClose}
      />

      {/* Drawer Container */}
      <div className="relative z-10 w-full sm:w-[min(640px,85vw)] h-full bg-slate-900 border-l border-white/10 text-white shadow-2xl flex flex-col motion-safe:animate-[slideIn_0.22s_cubic-bezier(0.16,1,0.3,1)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            {icon && <span className="text-indigo-400">{icon}</span>}
            <h2 id="drawer-title" className="text-lg font-semibold tracking-tight text-white/95">
              {title}
            </h2>
          </div>
          <IconButton
            icon={<X className="w-4 h-4" />}
            label="Close drawer"
            variant="ghost"
            size="sm"
            onClick={onClose}
          />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-6 space-y-6">
          {children}
        </div>
      </div>
    </div>
  );
}
