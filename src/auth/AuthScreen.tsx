import { useEffect, useState } from "react";
import { Compass, Mail, Lock, User, ArrowLeft, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import {
  useForgotPassword,
  useLogin,
  useRegister,
  useResetPassword,
} from "../api/endpoints/auth";
import { useAuth } from "./useAuth";
import { Button, Input } from "../components/ui";

type AuthMode = "login" | "register" | "forgot" | "reset";

export function AuthScreen() {
  const { setSession, expired, clearExpired } = useAuth();
  const [mode, setMode] = useState<AuthMode>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") ? "reset" : "login";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") ?? "";
  });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!expired) return;
    const id = setTimeout(() => clearExpired(), 5000);
    return () => clearTimeout(id);
  }, [expired, clearExpired]);

  const login = useLogin();
  const register = useRegister();
  const forgot = useForgotPassword();
  const reset = useResetPassword();

  const resetForm = () => {
    setError(null);
    setSuccessMessage(null);
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    resetForm();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const data = await login.mutateAsync({ email, password });
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const data = await register.mutateAsync({
        email,
        password,
        firstName,
        lastName,
      });
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await forgot.mutateAsync({ email });
      setSuccessMessage("If an account with that email exists, a reset link has been sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const data = await reset.mutateAsync({ token: resetToken, password });
      setSuccessMessage(data.message);
      setMode("login");
      setPassword("");
      if (window.history.replaceState) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
  };

  // Password requirement checks for register mode
  const passHasMin = password.length >= 8;
  const passHasUpper = /[A-Z]/.test(password);
  const passHasLower = /[a-z]/.test(password);
  const passHasNum = /\d/.test(password);
  const passHasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-8 relative overflow-hidden bg-slate-950 font-sans text-white select-none">
      {/* Background Animated Blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <span className="blob w-[580px] h-[580px] bg-indigo-600/40 -top-32 -left-32" />
        <span className="blob w-[500px] h-[500px] bg-violet-600/40 -bottom-40 -right-24 [animation-delay:-6s]" />
        <span className="blob w-[360px] h-[360px] bg-emerald-500/30 top-[35%] left-[55%] [animation-delay:-12s]" />
        <div className="bg-dots absolute inset-0 opacity-80" />
      </div>

      {/* Main Container Shell */}
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 rounded-3xl bg-slate-900/80 border border-white/15 backdrop-blur-2xl shadow-[0_24px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.12)] overflow-hidden relative z-10 animate-fade-up">
        
        {/* Left Side: Brand Showcase */}
        <div className="hidden md:flex flex-col justify-between p-10 bg-gradient-to-br from-indigo-500/20 via-violet-500/10 to-transparent border-r border-white/10 relative overflow-hidden">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3 px-4 py-2 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-md shadow-md">
              <Compass className="w-6 h-6 text-indigo-400" />
              <span className="text-xl font-bold tracking-tight text-white">Northstar</span>
            </div>

            <div className="space-y-3 pt-6">
              <h2 className="text-3xl font-extrabold tracking-tight leading-tight">
                Your Personal Command Center.
              </h2>
              <p className="text-sm text-white/70 leading-relaxed">
                Elevate your daily browser workflow with real-time transit schedules, smart bookmarks, weather insights, and attendance tracking.
              </p>
            </div>
          </div>

          <div className="pt-8 border-t border-white/10 flex items-center gap-3 text-xs text-white/50 font-mono">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Secure JWT Authentication</span>
          </div>
        </div>

        {/* Right Side: Auth Form */}
        <div className="p-6 sm:p-10 flex flex-col justify-center">
          {/* Header Mobile Brand */}
          <div className="md:hidden flex items-center justify-center gap-2 mb-6">
            <Compass className="w-6 h-6 text-indigo-400" />
            <span className="text-xl font-bold tracking-tight text-white">Northstar</span>
          </div>

          {/* Mode Switcher Tabs (Login / Register) */}
          {mode !== "forgot" && mode !== "reset" && (
            <div className="flex p-1 rounded-2xl bg-white/[0.06] border border-white/10 mb-6">
              <button
                type="button"
                onClick={() => switchMode("login")}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  mode === "login"
                    ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md"
                    : "text-white/60 hover:text-white"
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => switchMode("register")}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  mode === "register"
                    ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md"
                    : "text-white/60 hover:text-white"
                }`}
              >
                Register
              </button>
            </div>
          )}

          {/* Banners */}
          {error && (
            <div className="mb-4 rounded-xl bg-red-500/15 border border-red-400/30 p-3 text-xs text-red-200 flex items-center gap-2 animate-fade-up">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-4 rounded-xl bg-emerald-500/15 border border-emerald-400/30 p-3 text-xs text-emerald-200 flex items-center gap-2 animate-fade-up">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {expired && (
            <div className="mb-4 rounded-xl bg-amber-500/15 border border-amber-400/30 p-3 text-xs text-amber-200 animate-fade-up">
              Session expired. Please sign in again.
            </div>
          )}

          {/* Login Form */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                label="Email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                required
                autoFocus
              />
              <Input
                label="Password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                leftIcon={<Lock className="w-4 h-4" />}
                required
              />

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs text-indigo-300 hover:text-indigo-200 transition cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={login.isPending}
                className="w-full"
              >
                Sign In
              </Button>
            </form>
          )}

          {/* Register Form */}
          {mode === "register" && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="First Name"
                  type="text"
                  placeholder="Alex"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  leftIcon={<User className="w-4 h-4" />}
                  required
                />
                <Input
                  label="Last Name"
                  type="text"
                  placeholder="Morgan"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>

              <Input
                label="Email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                required
              />

              <Input
                label="Password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                leftIcon={<Lock className="w-4 h-4" />}
                required
              />

              {/* Password Checklist */}
              {password && (
                <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-1.5 text-[11px]">
                  <div className="font-semibold text-white/70 mb-1">Password Requirements:</div>
                  <div className="grid grid-cols-2 gap-1 text-white/60">
                    <span className={passHasMin ? "text-emerald-400 font-medium" : ""}>• 8+ characters</span>
                    <span className={passHasUpper ? "text-emerald-400 font-medium" : ""}>• Uppercase letter</span>
                    <span className={passHasLower ? "text-emerald-400 font-medium" : ""}>• Lowercase letter</span>
                    <span className={passHasNum ? "text-emerald-400 font-medium" : ""}>• Number</span>
                    <span className={passHasSpecial ? "text-emerald-400 font-medium" : ""}>• Special symbol</span>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={register.isPending}
                className="w-full"
              >
                Create Account
              </Button>
            </form>
          )}

          {/* Forgot Password */}
          {mode === "forgot" && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div className="space-y-1 mb-2">
                <h3 className="text-base font-semibold">Reset Password</h3>
                <p className="text-xs text-white/60">Enter your email to receive a password reset link.</p>
              </div>

              <Input
                label="Email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                required
                autoFocus
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={forgot.isPending}
                className="w-full"
              >
                Send Reset Link
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="md"
                leftIcon={<ArrowLeft className="w-4 h-4" />}
                onClick={() => switchMode("login")}
                className="w-full"
              >
                Back to Login
              </Button>
            </form>
          )}

          {/* Reset Token Password Form */}
          {mode === "reset" && (
            <form onSubmit={handleReset} className="space-y-4">
              <Input
                label="Reset Token"
                type="text"
                placeholder="Paste token from email"
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                required
                autoFocus
              />

              <Input
                label="New Password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                leftIcon={<Lock className="w-4 h-4" />}
                required
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={reset.isPending}
                className="w-full"
              >
                Set New Password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
