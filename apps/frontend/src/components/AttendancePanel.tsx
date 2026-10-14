import { Clock, ArrowLeft, Play, Square, Edit3, Settings, Save, Check } from "lucide-react";
import { useMemo, useState } from "react";
import {
  useAttendanceHistory,
  useClockIn,
  useClockOut,
  useCorrectAttendance,
  useCreateAttendance,
  useMonthAttendance,
  useTodayAttendance,
} from "../api/endpoints/attendance";
import type { Attendance } from "../api/types";
import { useAttendanceSettings } from "../hooks/useAttendanceSettings";
import { Modal } from "./Modal";
import { Badge, Button, IconButton, Input, Skeleton } from "./ui";
import { dailyOvertimeMinutes, dailyThresholdMinutes, dailyWorkMinutes, formatMinutes, monthOvertimeMinutes } from "../utils/overtime";

const DEFAULT_TZ =
  (import.meta.env.VITE_DEFAULT_TZ as string | undefined) ??
  Intl.DateTimeFormat().resolvedOptions().timeZone;

function monthInputValue(d = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parseNumberInput(value: string): number {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

export function AttendancePanel() {
  const [view, setView] = useState<"today" | "month" | "history" | "settings">("today");
  const [selected, setSelected] = useState<Attendance | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("edit");
  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const [month, setMonth] = useState(monthInputValue());
  const [formError, setFormError] = useState<string | null>(null);
  const [settings, setSettings] = useAttendanceSettings();
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);

  const today = useTodayAttendance(undefined, DEFAULT_TZ);
  const monthData = useMonthAttendance(month, DEFAULT_TZ);
  const clockIn = useClockIn(DEFAULT_TZ);
  const clockOut = useClockOut(DEFAULT_TZ);
  const correct = useCorrectAttendance();
  const create = useCreateAttendance();
  const history = useAttendanceHistory(selected?.id ?? "");

  const attendance = today.data?.attendance ?? null;

  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [reason, setReason] = useState("");

  const openEdit = (record: Attendance) => {
    setModalMode("edit");
    setSelected(record);
    setCreatingDate(null);
    setCheckIn(record.checkInLocal ?? "");
    setCheckOut(record.checkOutLocal ?? "");
    setReason("");
    setFormError(null);
    setEditOpen(true);
  };

  const openCreate = (date: string) => {
    setModalMode("create");
    setSelected(null);
    setCreatingDate(date);
    setCheckIn("");
    setCheckOut("");
    setReason("");
    setFormError(null);
    setEditOpen(true);
  };

  const handleClockIn = async () => {
    try {
      await clockIn.mutateAsync();
    } catch (err) {
      if (err instanceof Error && err.message.includes("Already clocked in")) {
        if (attendance) openEdit(attendance);
      }
    }
  };

  const handleClockOut = async () => {
    try {
      await clockOut.mutateAsync();
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("Already clocked out") ||
          err.message.includes("No clock-in found"))
      ) {
        if (attendance) openEdit(attendance);
      }
    }
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!checkIn && !checkOut) {
      setFormError("At least one of check-in or check-out is required");
      return;
    }
    try {
      if (modalMode === "create") {
        if (!creatingDate) return;
        await create.mutateAsync({
          date: creatingDate,
          tz: DEFAULT_TZ,
          checkIn: checkIn || undefined,
          checkOut: checkOut || undefined,
          reason: reason || undefined,
        });
      } else {
        if (!selected) return;
        await correct.mutateAsync({
          id: selected.id,
          checkIn: checkIn || undefined,
          checkOut: checkOut || undefined,
          reason: reason || undefined,
        });
      }
      setEditOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleWorkHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft((prev) => ({ ...prev, workHoursPerDay: parseNumberInput(e.target.value) }));
  };
  const handleLunchStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft((prev) => ({ ...prev, lunchStart: e.target.value }));
  };
  const handleLunchEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft((prev) => ({ ...prev, lunchEnd: e.target.value }));
  };
  const handleTargetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft((prev) => ({ ...prev, monthlyOvertimeTargetHours: parseNumberInput(e.target.value) }));
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setSettings(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  const summary = monthData.data?.summary;
  const records = useMemo(() => monthData.data?.records ?? [], [monthData.data]);
  const recordsByDate = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const record of records) {
      map.set(record.date, record);
    }
    return map;
  }, [records]);

  const monthDays = useMemo(() => {
    const [year, monthNum] = month.split("-").map(Number);
    if (!year || !monthNum) return [];
    const days = new Date(year, monthNum, 0).getDate();
    return Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    });
  }, [month]);

  const todayDateStr = new Date().toLocaleDateString("en-CA", {
    timeZone: DEFAULT_TZ,
  });

  const totalOvertimeMinutes = useMemo(
    () => monthOvertimeMinutes(records, settings),
    [records, settings]
  );
  const overtimeTargetMinutes = settings.monthlyOvertimeTargetHours * 60;
  const overtimeProgress =
    overtimeTargetMinutes > 0
      ? (totalOvertimeMinutes / overtimeTargetMinutes) * 100
      : 0;

  return (
    <aside className="h-full min-h-0 flex flex-col rounded-3xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 backdrop-blur-xl p-6 shadow-[0_12px_32px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h2 className="text-lg font-bold flex items-center gap-2 text-white">
          <Clock className="w-5 h-5 text-emerald-400" />
          <span>Attendance</span>
        </h2>

        {/* View Switcher Pills */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/[0.06] border border-white/10">
          <button
            type="button"
            onClick={() => setView("today")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              view === "today" ? "bg-indigo-500 text-white shadow-md" : "text-white/60 hover:text-white"
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setView("month")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              view === "month" ? "bg-indigo-500 text-white shadow-md" : "text-white/60 hover:text-white"
            }`}
          >
            Month
          </button>
          <button
            type="button"
            onClick={() => setView("settings")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              view === "settings" ? "bg-indigo-500 text-white shadow-md" : "text-white/60 hover:text-white"
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      <div className="text-[11px] text-white/40 mb-4 font-mono shrink-0">
        Timezone: {DEFAULT_TZ}
      </div>

      {view === "today" && (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {today.isLoading && (
            <div className="space-y-4">
              <Skeleton variant="rectangular" className="h-40 rounded-2xl" />
            </div>
          )}

          {today.error && (
            <div className="rounded-2xl bg-red-500/15 border border-red-400/30 p-4 text-xs text-red-200">
              {today.error.message}
            </div>
          )}

          {!today.isLoading && !today.error && (
            <div className="flex flex-col gap-4">
              {/* Case 1: Not Clocked In */}
              {!attendance && (
                <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-6 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center text-emerald-400 animate-pulse-glow">
                    <Play className="w-8 h-8 translate-x-0.5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">Not Clocked In Today</h3>
                    <p className="text-xs text-white/50 mt-1">Start your work session timer</p>
                  </div>
                  <Button
                    variant="primary"
                    size="lg"
                    isLoading={clockIn.isPending}
                    onClick={handleClockIn}
                    className="w-full max-w-xs shadow-lg shadow-indigo-500/30"
                  >
                    Clock In Now
                  </Button>
                </div>
              )}

              {/* Case 2: Clocked In (Active Session) */}
              {attendance && !attendance.checkOutAt && (
                <div className="rounded-2xl bg-gradient-to-br from-emerald-500/15 via-teal-500/10 to-transparent border border-emerald-400/30 p-6 flex flex-col items-center text-center space-y-4">
                  <Badge variant="success" dot size="md">
                    Session Active
                  </Badge>
                  <div>
                    <div className="text-xs text-white/60 font-medium uppercase tracking-wider">Clocked in at</div>
                    <div className="text-4xl font-black text-white tracking-tight tabular-nums mt-1">
                      {attendance.checkInLocal}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 w-full max-w-xs pt-2">
                    <Button
                      variant="danger"
                      size="md"
                      isLoading={clockOut.isPending}
                      leftIcon={<Square className="w-4 h-4 fill-current" />}
                      onClick={handleClockOut}
                      className="flex-1"
                    >
                      Clock Out
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      leftIcon={<Edit3 className="w-4 h-4 text-white/60" />}
                      onClick={() => openEdit(attendance)}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              )}

              {/* Case 3: Completed Session */}
              {attendance && attendance.checkOutAt && (
                <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-6 flex flex-col items-center text-center space-y-4">
                  <Badge variant="primary" size="md">
                    Session Complete
                  </Badge>
                  <div>
                    <div className="text-xs text-white/60 font-medium uppercase tracking-wider">Total Worked</div>
                    <div className="text-4xl font-black text-white tracking-tight tabular-nums mt-1">
                      {formatMinutes(attendance.workedMinutes)}
                    </div>
                    {attendance.workedMinutes !== null && (
                      <div className="text-xs font-medium mt-1">
                        {(() => {
                          const ot = dailyOvertimeMinutes(
                            attendance.workedMinutes,
                            attendance.checkInLocal,
                            attendance.checkOutLocal,
                            settings
                          );
                          const work = dailyWorkMinutes(
                            attendance.workedMinutes,
                            attendance.checkInLocal,
                            attendance.checkOutLocal,
                            settings
                          );
                          return ot > 0 ? (
                            <span className="text-emerald-400">
                              Overtime today: +{formatMinutes(ot)}
                            </span>
                          ) : (
                            <span className="text-white/50">
                              Regular day — {formatMinutes(dailyThresholdMinutes(settings) - work)} until overtime
                            </span>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-4 text-xs font-semibold text-white/70 bg-white/[0.04] px-4 py-2 rounded-xl border border-white/10 w-full">
                    <span>In: <strong className="text-white">{attendance.checkInLocal}</strong></span>
                    <span className="text-white/30">•</span>
                    <span>Out: <strong className="text-white">{attendance.checkOutLocal}</strong></span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Edit3 className="w-3.5 h-3.5 text-indigo-400" />}
                    onClick={() => openEdit(attendance)}
                  >
                    Adjust Time
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {view === "month" && (
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-auto cursor-pointer"
            />
          </div>

          {monthData.isLoading && (
            <div className="space-y-3">
              <Skeleton variant="rectangular" className="h-20 rounded-2xl" />
              <Skeleton variant="rectangular" className="h-16 rounded-2xl" />
            </div>
          )}

          {monthData.error && (
            <div className="rounded-2xl bg-red-500/15 border border-red-400/30 p-3.5 text-xs text-red-200">
              {monthData.error.message}
            </div>
          )}

          {summary && (
            <div className="grid grid-cols-2 gap-2.5 shrink-0">
              <div className="col-span-2 rounded-2xl bg-white/[0.06] border border-white/10 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold">Monthly Overtime</div>
                  {overtimeProgress >= 100 && (
                    <Badge variant="success" dot size="sm">
                      Target hit
                    </Badge>
                  )}
                </div>
                <div className="text-base font-bold text-white truncate">
                  {formatMinutes(totalOvertimeMinutes)}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-white/60 font-medium">
                    <span>{formatMinutes(totalOvertimeMinutes)}</span>
                    <span>target {formatMinutes(overtimeTargetMinutes)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, overtimeProgress)}%` }}
                    />
                  </div>
                </div>
              </div>
              <Stat label="Days Present" value={summary.daysPresent} />
              <Stat label="Completed" value={summary.daysCompleted} />
              <Stat label="Total Hours" value={formatMinutes(summary.totalWorkedMinutes)} />
              <Stat label="Daily Average" value={formatMinutes(summary.averageWorkedMinutes)} />
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {monthDays.map((dateStr) => {
              const record = recordsByDate.get(dateStr);
              if (record) {
                return (
                  <div
                    key={dateStr}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelected(record);
                      setView("history");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(record);
                        setView("history");
                      }
                    }}
                    className="w-full text-left rounded-2xl bg-white/[0.05] border border-white/10 p-3.5 hover:bg-white/[0.1] transition-all cursor-pointer flex items-center justify-between group"
                  >
                    <div>
                      <div className="font-semibold text-sm text-white group-hover:text-indigo-300 transition-colors">
                        {record.date}
                      </div>
                      <div className="text-xs text-white/50 mt-0.5 font-mono">
                        {record.checkInLocal ?? "—"} → {record.checkOutLocal ?? "—"}
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <Badge variant="neutral" size="sm">
                        {formatMinutes(record.workedMinutes)}
                      </Badge>
                      {(() => {
                        const ot = dailyOvertimeMinutes(
                          record.workedMinutes,
                          record.checkInLocal,
                          record.checkOutLocal,
                          settings
                        );
                        return ot > 0 ? (
                          <Badge variant="success" size="sm">
                            +{ot}m OT
                          </Badge>
                        ) : null;
                      })()}
                      <IconButton
                        icon={<Edit3 className="w-3.5 h-3.5" />}
                        label="Edit time"
                        variant="ghost"
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(record);
                        }}
                      />
                    </div>
                  </div>
                );
              }

              const isFuture = dateStr > todayDateStr;
              const isPast = dateStr < todayDateStr;
              const isToday = dateStr === todayDateStr;
              return (
                <div
                  key={dateStr}
                  className="w-full rounded-2xl bg-white/[0.03] border border-white/[0.07] p-3.5 flex items-center justify-between text-white/40"
                >
                  <div>
                    <div className="font-semibold text-sm text-white/70">{dateStr}</div>
                    <div className="text-xs mt-0.5 font-mono">
                      {isFuture ? "Future date" : isToday ? "Not clocked in yet" : "No record"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isFuture && (
                      <Badge variant="neutral" size="sm">
                        Future
                      </Badge>
                    )}
                    {isPast && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openCreate(dateStr)}
                      >
                        Add Record
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "history" && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center justify-between shrink-0">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => setView("month")}
            >
              Back to Month
            </Button>
            {selected && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Edit3 className="w-4 h-4" />}
                onClick={() => openEdit(selected)}
              >
                Adjust Time
              </Button>
            )}
          </div>

          {selected && (
            <div className="text-xs font-semibold text-indigo-300 shrink-0 px-1">
              Audit log for {selected.date} ({formatMinutes(selected.workedMinutes)})
            </div>
          )}

          {history.isLoading && (
            <div className="space-y-3">
              <Skeleton variant="rectangular" className="h-16 rounded-2xl" />
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
            {history.data?.edits.length === 0 && (
              <div className="text-center py-8 text-white/50 text-xs">
                No time correction logs recorded.
              </div>
            )}
            {history.data?.edits.map((edit) => (
              <div
                key={edit.id}
                className="rounded-2xl bg-white/[0.05] border border-white/10 p-3.5 space-y-1"
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-indigo-300">
                    {edit.field === "CHECK_IN" ? "Check-in Edit" : "Check-out Edit"}
                  </span>
                  <span className="text-[10px] text-white/40 font-mono">
                    {new Date(edit.editedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-xs text-white/90 font-mono">
                  {edit.oldValueLocal ?? "—"} → <strong className="text-emerald-400">{edit.newValueLocal ?? "—"}</strong>
                </div>
                {edit.reason && (
                  <div className="text-xs text-white/50 italic pt-1">
                    "{edit.reason}"
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "settings" && (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-400 text-sm">
              <Settings className="w-4 h-4" />
              <span className="font-semibold">Attendance Settings</span>
            </div>
            <Input
              label="Work hours per day"
              type="number"
              min={0}
              step={0.5}
              value={draft.workHoursPerDay}
              onChange={handleWorkHoursChange}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Lunch start"
                type="time"
                value={draft.lunchStart}
                onChange={handleLunchStartChange}
              />
              <Input
                label="Lunch end"
                type="time"
                value={draft.lunchEnd}
                onChange={handleLunchEndChange}
              />
            </div>
            <Input
              label="Monthly overtime target (hours)"
              type="number"
              min={0}
              step={1}
              value={draft.monthlyOvertimeTargetHours}
              onChange={handleTargetChange}
            />
            <p className="text-xs text-white/50">
              Lunch break window: {draft.lunchStart}–{draft.lunchEnd}. Overtime starts after{" "}
              {draft.workHoursPerDay}h of actual work (excluding the overlapping lunch break).
            </p>
            <Button
              type="submit"
              variant="primary"
              size="md"
              leftIcon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            >
              {saved ? "Saved" : "Save Settings"}
            </Button>
          </form>
        </div>
      )}

      {/* Create / Edit Correction Modal */}
      <Modal
        open={editOpen}
        title={modalMode === "create" ? "Add Attendance Record" : "Time Correction"}
        onClose={() => setEditOpen(false)}
      >
        <form onSubmit={handleModalSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-xl bg-red-500/15 border border-red-400/30 p-3 text-xs text-red-200">
              {formError}
            </div>
          )}
          {modalMode === "create" && creatingDate && (
            <Input
              label="Date"
              type="text"
              value={creatingDate}
              disabled
              className="opacity-70"
            />
          )}
          <Input
            label="Check-in (HH:MM)"
            type="text"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            placeholder="09:00"
          />
          <Input
            label="Check-out (HH:MM)"
            type="text"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            placeholder="18:00"
          />
          <Input
            label="Reason / Note"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Forgot to clock out"
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" size="md" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={create.isPending || correct.isPending}
            >
              {modalMode === "create" ? "Add Record" : "Save Correction"}
            </Button>
          </div>
        </form>
      </Modal>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold">{label}</div>
      <div className="text-base font-bold text-white truncate mt-0.5">{value ?? "—"}</div>
    </div>
  );
}
