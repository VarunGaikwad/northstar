import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { clearUserPersistentCache } from "../api/persistentCache";
import { queryClient } from "../api/queryClient";
import type { AuthResponse, User } from "../api/types";
import {
  RefreshRejectedError,
  applyAuthData,
  getAuthState,
  initializeAuthSession,
  logoutAllSessions,
  logoutSession,
  restoreVisibleSession,
  subscribeAuth,
} from "./session";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  restoreError: string | null;
  expired: boolean;
  clearExpired: () => void;
  retryRestore: () => Promise<void>;
  setSession: (data: AuthResponse) => void;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useSyncExternalStore(subscribeAuth, getAuthState, getAuthState);
  const previousUserId = useRef<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const retryRestore = useCallback(async () => {
    setRestoreError(null);
    try {
      await restoreVisibleSession();
    } catch (error) {
      if (!(error instanceof RefreshRejectedError)) {
        setRestoreError(
          error instanceof Error ? error.message : "Unable to restore the session",
        );
      }
    } finally {
      setIsInitializing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      await initializeAuthSession();
      if (!cancelled) await retryRestore();
    };
    void initialize();

    return () => {
      cancelled = true;
    };
  }, [retryRestore]);

  useEffect(() => {
    const restoreWhenVisible = () => {
      if (document.visibilityState === "visible") void retryRestore();
    };
    document.addEventListener("visibilitychange", restoreWhenVisible);
    return () => document.removeEventListener("visibilitychange", restoreWhenVisible);
  }, [retryRestore]);

  useEffect(() => {
    const onExpired = () => setExpired(true);
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  useEffect(() => {
    const currentUserId = auth.user?.id ?? null;
    const oldUserId = previousUserId.current;
    if (oldUserId && oldUserId !== currentUserId) {
      clearUserPersistentCache(oldUserId);
      queryClient.removeQueries({ queryKey: ["favlinks", oldUserId] });
      queryClient.removeQueries({ queryKey: ["folders", oldUserId] });
      queryClient.removeQueries({ queryKey: ["notes", oldUserId] });
      queryClient.removeQueries({ queryKey: ["me"] });
    }
    previousUserId.current = currentUserId;
  }, [auth.user]);

  const setSession = useCallback((data: AuthResponse) => {
    applyAuthData(data);
    setExpired(false);
    setRestoreError(null);
  }, []);

  const clearExpired = useCallback(() => setExpired(false), []);

  return (
    <AuthContext.Provider
      value={{
        user: auth.user,
        token: auth.accessToken,
        isAuthenticated: auth.user !== null && auth.accessToken !== null,
        isInitializing,
        restoreError,
        expired,
        clearExpired,
        retryRestore,
        setSession,
        logout: logoutSession,
        logoutAll: logoutAllSessions,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export { AuthContext };
