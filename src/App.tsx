import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import { AuthScreen } from "./auth/AuthScreen";
import { useAuth } from "./auth/useAuth";
import { Button } from "./components/ui";
import Dashboard from "./Dashboard";

export default function App() {
  const { isAuthenticated, isInitializing, restoreError, retryRestore } = useAuth();

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-white/70">
          <LoaderCircle className="w-5 h-5 animate-spin text-indigo-400" />
          Restoring your session
        </div>
      </div>
    );
  }

  if (restoreError && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900/80 p-8 text-center shadow-2xl backdrop-blur-xl">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-4" />
          <h1 className="text-lg font-bold">Session temporarily unavailable</h1>
          <p className="mt-2 mb-6 text-sm leading-relaxed text-white/60">{restoreError}</p>
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full"
            leftIcon={<RefreshCw className="w-4 h-4" />}
            onClick={() => void retryRestore()}
          >
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return isAuthenticated ? <Dashboard /> : <AuthScreen />;
}
