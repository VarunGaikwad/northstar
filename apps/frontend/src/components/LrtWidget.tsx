import { ArrowDown, ArrowRightLeft, TrainFront, Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLrtSearch, useLrtStations } from "../api/endpoints/lrt";
import { parseHMM, tokyoDate, tokyoMinutes } from "../api/timeFormat";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { Badge, Skeleton } from "./ui";

const MAX_UPCOMING = 6;

function nowMinutes(): number {
  return tokyoMinutes();
}

interface PlannedTrain {
  depart: string;
  arrive: string;
  departMin: number;
  arriveNextDay: boolean;
  durationMins: number;
  direction: "INBOUND" | "OUTBOUND";
  trainType: "LOCAL" | "RAPID";
}

export function LrtWidget() {
  const { data: stationsData, isLoading: stationsLoading } = useLrtStations();
  const stations = useMemo(() => stationsData?.stations ?? [], [stationsData]);
  const first = stations[0]?.code ?? 0;
  const last = stations[stations.length - 1]?.code ?? 0;

  const [fromCode, setFromCode] = useLocalStorage<number>(
    "dashboard.lrtFrom",
    first
  );
  const [toCode, setToCode] = useLocalStorage<number>(
    "dashboard.lrtTo",
    last
  );

  useEffect(() => {
    if (stations.length && !stations.find((s) => s.code === fromCode)) {
      setFromCode(first);
    }
    if (stations.length && !stations.find((s) => s.code === toCode)) {
      setToCode(last);
    }
  }, [stations, fromCode, toCode, first, last, setFromCode, setToCode]);

  const [now, setNow] = useState(nowMinutes);
  useEffect(() => {
    const id = setInterval(() => setNow(nowMinutes()), 30_000);
    return () => clearInterval(id);
  }, []);

  const from = stations.find((s) => s.code === fromCode) ?? stations[0];
  const to = stations.find((s) => s.code === toCode) ?? stations[stations.length - 1];
  const sameStation = from?.code === to?.code;
  const direction =
    from && to ? (from.code < to.code ? "INBOUND" : "OUTBOUND") : "INBOUND";

  const serviceDate = tokyoDate();
  const { data: searchData, isLoading: searchLoading, error } = useLrtSearch({
    from: fromCode,
    to: toCode,
    date: serviceDate,
    enabled: !sameStation && stations.length > 0,
  });

  const plans: PlannedTrain[] = useMemo(() => {
    if (sameStation || !searchData) return [];
    return searchData.trips.map((t) => ({
      depart: t.from.time ?? "",
      arrive: t.to.time ?? "",
      departMin:
        parseHMM(t.from.time ?? "") + (t.from.isNextDay ? 24 * 60 : 0),
      arriveNextDay: t.to.isNextDay,
      durationMins: t.durationMins,
      direction: t.direction,
      trainType: t.trainType,
    }));
  }, [searchData, sameStation]);

  const upcoming = plans.filter((p) => p.departMin >= now).slice(0, MAX_UPCOMING);

  const swap = () => {
    if (!from || !to) return;
    setFromCode(to.code);
    setToCode(from.code);
  };

  const selectCls =
    "w-full rounded-xl bg-white/[0.08] border border-white/15 px-3 py-2 text-xs font-semibold text-white outline-none cursor-pointer hover:bg-white/[0.12] focus:border-indigo-400 transition-colors [&>option]:bg-slate-900";

  return (
    <aside className="h-full min-h-0 flex flex-col rounded-3xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 backdrop-blur-xl p-6 shadow-[0_12px_32px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold flex items-center gap-2 text-white">
          <TrainFront className="w-5 h-5 text-purple-400" />
          <span>Light Rail Transit</span>
        </h2>
        <Badge variant="success" dot size="sm">
          Today’s Timetable
        </Badge>
      </div>

      {/* Station Selector Bar */}
      <div className="flex items-center gap-2 mb-5 shrink-0 bg-white/[0.04] p-3 rounded-2xl border border-white/10">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">From</span>
          <select
            value={fromCode}
            onChange={(e) => setFromCode(Number(e.target.value))}
            aria-label="From station"
            className={selectCls}
          >
            {stations.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={swap}
          aria-label="Swap stations"
          title="Swap stations"
          className="shrink-0 mt-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white/80 hover:text-white flex items-center justify-center transition-all duration-300 active:scale-95 cursor-pointer"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">To</span>
          <select
            value={toCode}
            onChange={(e) => setToCode(Number(e.target.value))}
            aria-label="To station"
            className={selectCls}
          >
            {stations.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(stationsLoading || searchLoading) && (
        <div className="space-y-3 mb-4">
          <Skeleton variant="rectangular" className="h-16 rounded-2xl" />
          <Skeleton variant="rectangular" className="h-16 rounded-2xl" />
          <Skeleton variant="rectangular" className="h-16 rounded-2xl" />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-2xl bg-red-500/15 border border-red-400/30 p-3.5 text-xs text-red-200">
          {error.message}
        </div>
      )}

      {!sameStation && !stationsLoading && !searchLoading && !error && from && to && (
        <div className="flex items-center justify-between mb-3 px-1 shrink-0">
          <span className="text-xs font-semibold text-white/70">{from.name}</span>
          <Badge variant={direction === "INBOUND" ? "primary" : "success"} size="sm">
            {direction === "INBOUND" ? "Inbound →" : "← Outbound"}
          </Badge>
          <span className="text-xs font-semibold text-white/70">{to.name}</span>
        </div>
      )}

      {sameStation ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-white/50 p-6 space-y-2">
          <TrainFront className="w-8 h-8 text-white/30 stroke-1" />
          <p className="text-xs">Select two different stations to view train schedule.</p>
        </div>
      ) : upcoming.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-white/50 p-6 space-y-2">
          <Clock className="w-8 h-8 text-white/30 stroke-1" />
          <p className="text-xs">No upcoming departures scheduled for today.</p>
        </div>
      ) : (
        <ul className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
          {upcoming.map((p, i) => {
            const minutesUntil = p.departMin - now;
            return (
              <li
                key={`${p.depart}-${p.direction}-${i}`}
                className={`flex items-center gap-3 rounded-2xl p-3.5 border transition-all duration-200 ${
                  i === 0
                    ? "bg-gradient-to-r from-indigo-500/25 via-violet-500/15 to-transparent border-indigo-400/40 shadow-lg shadow-indigo-500/10"
                    : "bg-white/[0.05] border-white/10 hover:bg-white/[0.1]"
                }`}
              >
                <div className="flex flex-col items-center shrink-0 w-14">
                  <span className="text-base font-bold text-white tabular-nums leading-none">
                    {p.depart}
                  </span>
                  <ArrowDown className="w-3 h-3 text-white/40 my-1" />
                  <span className="text-xs font-medium text-white/70 tabular-nums leading-none">
                    {p.arrive}
                    {p.arriveNextDay && <span className="ml-0.5 text-[9px] text-amber-300">+1</span>}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {p.durationMins} mins
                    </span>
                    {i === 0 && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 bg-indigo-400/20 px-2 py-0.5 rounded-full">
                        In {minutesUntil <= 0 ? "Now" : `${minutesUntil}m`}
                      </span>
                    )}
                  </div>
                </div>

                <Badge variant={p.trainType === "RAPID" ? "danger" : "success"} size="sm">
                  {p.trainType === "RAPID" ? "Rapid" : "Local"}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 pt-3 border-t border-white/10 shrink-0 text-[11px] text-white/40 text-center font-mono">
        {plans.length} scheduled trips today · Japan time
      </div>
    </aside>
  );
}
