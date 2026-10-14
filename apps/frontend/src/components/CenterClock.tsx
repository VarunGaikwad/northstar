import { useAuth } from "../auth/useAuth";
import { useClock } from "../hooks/useClock";

export function CenterClock() {
  const { user } = useAuth();
  const { timeShort, greeting } = useClock();
  const name = user?.firstName ?? user?.lastName ?? user?.email?.split("@")[0] ?? "User";

  return (
    <div className="flex flex-col items-center justify-center text-center text-white select-none animate-fade-up">
      {/* Giant tabular clock display */}
      <div className="text-[7.5rem] sm:text-[9.5rem] md:text-[11.5rem] leading-none font-extrabold tracking-tighter tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-white via-white/95 to-white/80 drop-shadow-[0_4px_30px_rgba(0,0,0,0.6)]">
        {timeShort}
      </div>

      {/* Personalized greeting */}
      <h1 className="mt-2 sm:mt-4 text-xl sm:text-2xl md:text-3xl font-semibold capitalize tracking-tight text-white/90 drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)]">
        {greeting.toLowerCase()}, <span className="text-indigo-300 font-bold">{name}</span>.
      </h1>
    </div>
  );
}
