import { useClock } from "../hooks/useClock";

interface ClockProps {
  user: string;
}

export function Clock({ user }: ClockProps) {
  const { time, date, greeting } = useClock();

  return (
    <div className="flex flex-col items-center gap-2 animate-[focus-appear_0.6s_ease-out]">
      <div className="text-[clamp(3rem,12vw,7rem)] font-extralight tabular-nums tracking-wide text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.3)] leading-none">
        {time.slice(0, 5)}
      </div>
      <div className="text-xl md:text-2xl font-light text-white/90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
        {greeting}, {user}
      </div>
      <div className="text-sm font-medium text-white/50 tracking-wide">
        {date}
      </div>
    </div>
  );
}
