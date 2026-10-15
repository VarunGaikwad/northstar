import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./ui";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  dismissible?: boolean;
}

/** Reusable glass modal shell: overlay click + Escape close + ARIA accessibility. */
export function Modal({
  open,
  title,
  onClose,
  children,
  dismissible = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeModal = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    (focusable()[0] ?? panel)?.focus();

    const observer = panel
      ? new MutationObserver(() => {
          if (!panel.contains(document.activeElement)) {
            (focusable()[0] ?? panel)?.focus();
          }
        })
      : null;
    observer?.observe(panel!, { childList: true, subtree: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!panel?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      observer?.disconnect();
      if (
        previousFocus?.isConnected &&
        !previousFocus.matches(":disabled")
      ) {
        previousFocus.focus();
      } else {
        document
          .querySelector<HTMLElement>('#notes-workspace [aria-label="Close notes"]')
          ?.focus();
      }
    };
  }, [dismissible, open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md transition-opacity animate-fade-up"
      onClick={(e) =>
        dismissible && e.target === e.currentTarget && onClose()
      }
    >
      <div ref={panelRef} tabIndex={-1} className="w-full max-w-sm rounded-2xl bg-slate-900/90 backdrop-blur-2xl border border-white/15 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] text-white animate-[pop_0.2s_cubic-bezier(0.16,1,0.3,1)]">
        <div className="flex items-center justify-between mb-4">
          <h3 id="modal-title" className="text-lg font-semibold tracking-tight text-white/95">
            {title}
          </h3>
          {dismissible && (
            <IconButton
              icon={<X className="w-4 h-4" />}
              label="Close modal"
              variant="ghost"
              size="sm"
              onClick={onClose}
            />
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
