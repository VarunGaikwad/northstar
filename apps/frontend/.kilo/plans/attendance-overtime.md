# Attendance: Month Overtime & Settings (Frontend-only)

## Goal
Enhance the Attendance panel so the user can:
1. View attendance for a whole month (already exists — keep + enhance with overtime).
2. Edit/correct **previous** dates (not just today).
3. Configure a **monthly overtime target** (goal hours to accumulate).
4. Configure **lunch break hours**.
5. Configure **work hours per day** — `workHours + lunchBreak` is the daily presence threshold; any time worked beyond it counts as overtime for that day.

## Scope
Frontend-only. Settings persist in `localStorage`. Overtime is computed in the browser from existing `/attendance/me/month` data. No backend changes.

## Overtime model (decided)
- `workHoursPerDay` (default 8)
- `lunchBreakMinutes` (default 60)
- `monthlyOvertimeTargetHours` (default 20) — *goal* hours of overtime to accumulate in the month.

Per-day computation (assumes `workedMinutes` = wall-clock span checkOut−checkIn, which includes lunch):
```
dailyThresholdMinutes = workHoursPerDay*60 + lunchBreakMinutes   // e.g. 8h + 1h = 9h = 540min
dailyOvertimeMinutes = max(0, workedMinutes - dailyThresholdMinutes)
```
Month:
```
totalOvertimeMinutes = Σ dailyOvertimeMinutes         // only over completed records (checkOut present)
progressPct = totalOvertimeMinutes / (monthlyOvertimeTargetHours*60) * 100
```

## Settings storage
New hook `src/hooks/useAttendanceSettings.ts` built on `useLocalStorage` with key `attendance.settings`:
```ts
interface AttendanceSettings {
  workHoursPerDay: number;        // hours
  lunchBreakMinutes: number;      // minutes
  monthlyOvertimeTargetHours: number; // hours
}
// defaults: { workHoursPerDay: 8, lunchBreakMinutes: 60, monthlyOvertimeTargetHours: 20 }
```
Only one shared instance; key is stable so all components read the same value.

## Helper module
New `src/utils/overtime.ts` with pure functions (unit-friendly, easy to reason about):
- `dailyOvertimeMinutes(workedMinutes, settings)`
- `monthOvertimeMinutes(records: Attendance[], settings)` — skips records with null `workedMinutes` or `checkOutAt`.
- `formatMinutes` can stay in AttendancePanel but move a copy here if reused; otherwise compute inline.

## UI changes — `AttendancePanel.tsx`

### A. Settings entry point
Add a 3rd pill button **"Settings"** (gear icon, `lucide-react` `Settings`) to the existing pill switcher next to Today/Month. New `view: "today" | "month" | "history" | "settings"`.

### B. Settings view (new)
Form (uses `Input` + `Button` from `./ui`):
- "Work hours per day" — `type="number"`, min 0, step 0.5.
- "Lunch break (minutes)" — `type="number"`, min 0, step 5.
- "Monthly overtime target (hours)" — `type="number"`, min 0, step 1.
- Save button writes to `useAttendanceSettings`; show a small "Saved" confirmation (auto-dismiss).
- Helper text under thresholds: "Overtime starts after {workHours}h work + {lunch}m lunch = {threshold} per day."

### C. Today view — overtime earned today
In the "Completed Session" card, below `Total Worked`, add a small line:
- If `workedMinutes > dailyThresholdMinutes`: green text "Overtime today: +Xh Ym".
- Else: muted "Regular day — {N}m until overtime".
Uses settings + helper.

### D. Month view — overtime stats + progress
Augment the existing summary grid (keep 4 existing Stat cards) by adding an **Overtime block**:
1. A wide card (col-span-2) titled "Monthly Overtime" showing:
   - big number `formatMinutes(totalOvertimeMinutes)`
   - progress bar toward `monthlyOvertimeTargetHours` (use `min(100, progressPct)`) with label `Xh / targetYh`.
   - target hit badge (success) when ≥ 100%.
2. Per-record row enhancement: in the existing record button, when `dailyOvertimeMinutes > 0`, append a small green "+Xm OT" badge next to the existing worked-minutes badge.

### E. Edit previous dates
The month record list already navigates to the `history` view on click (audit log). Add an explicit **Edit Time** action so previous dates are correctable:
- In the **history** view header (next to the record date line), add a `Button` ("Adjust Time", `Edit3` icon) that calls `openEdit(selected)` to open the existing correction modal — works for any record.
- Optional: on the month record row, add a tiny `Edit3` icon button (stopPropagation) that opens the modal directly without going to history. (Choose ONE place to avoid duplication — prefer the history view Edit button, since audit + edit together is clearer. Mark month-row icon as optional/nice-to-have.)
- The existing correction modal already accepts `checkIn`/`checkOut`/`reason` and calls `useCorrectAttendance` by `id` — no API change needed; it works for any past record id.

## Files to change
- **New** `src/hooks/useAttendanceSettings.ts` — localStorage-backed settings hook.
- **New** `src/utils/overtime.ts` — pure overtime math.
- **Edit** `src/components/AttendancePanel.tsx` — settings view, today overtime line, month overtime stats + per-record OT badges, edit-previous-date button in history.
- (No `types.ts` or endpoint changes — settings are client-only.)

## Validation
- `npx tsc -b --noEmit`
- `npm run lint -- --max-warnings=0`
- Manual: open Attendance → Settings, set 8h/60m/20h → Month view shows overtime stats + per-day OT badges; click a past day → history → "Adjust Time" opens modal; save correction invalidates month query.

## Non-goals
- No backend endpoints, no schema changes.
- No editing future dates.
- Lunch break is assumed included in workedMinutes; we are not subtracting it twice.