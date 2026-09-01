import { AlertTriangle } from "lucide-react";
import { Component, createRef, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  modal?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private readonly fallbackRef = createRef<HTMLDivElement>();
  private readonly reloadButtonRef = createRef<HTMLButtonElement>();

  private readonly keepModalFocus = (event: FocusEvent): void => {
    if (
      this.props.modal &&
      event.target instanceof Node &&
      !this.fallbackRef.current?.contains(event.target)
    ) {
      this.reloadButtonRef.current?.focus();
    }
  };

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    if (this.props.modal) {
      document.addEventListener("focusin", this.keepModalFocus);
    }
    this.reloadButtonRef.current?.focus();
  }

  componentWillUnmount(): void {
    document.removeEventListener("focusin", this.keepModalFocus);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          ref={this.fallbackRef}
          role={this.props.modal ? "alertdialog" : "alert"}
          aria-modal={this.props.modal || undefined}
          aria-label="Application error"
          className="h-full rounded-3xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 backdrop-blur-xl p-6 shadow-[0_12px_32px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.1)] flex flex-col items-center justify-center text-center gap-3"
          onKeyDown={(event) => {
            if (this.props.modal && event.key === "Tab") {
              event.preventDefault();
              this.reloadButtonRef.current?.focus();
            }
          }}
        >
          <AlertTriangle className="w-8 h-8 text-amber-400" />
          <div className="text-sm font-medium text-slate-300">
            Something went wrong.
          </div>
          <button
            ref={this.reloadButtonRef}
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-indigo-400 to-violet-500 shadow-[0_6px_18px_rgba(108,140,255,0.35)] hover:-translate-y-px transition cursor-pointer"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
