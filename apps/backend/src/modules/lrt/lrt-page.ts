import type { Request, Response } from "express";
import { publicPage } from "../../utils/public-page";

export function lrtPage(_req: Request, res: Response): void {
  publicPage(res, "LRT timetable", `
<h1>LRT timetable</h1>
<p>Browse departures and expand a train to see every stop. No account needed.</p>
<form id="timetable-form">
<label for="date">Travel date<input id="date" type="date" required></label>
<label for="direction">Direction<select id="direction"><option value="">Both directions</option><option value="INBOUND">Inbound · toward Utsunomiya</option><option value="OUTBOUND">Outbound · toward Haga</option></select></label>
<label for="day-type">Schedule<select id="day-type"><option value="">Automatic for date</option><option value="WEEKDAY">Weekday</option><option value="HOLIDAY">Weekend / holiday</option></select></label>
<button id="submit" type="submit">Show timetable</button></form>
<p id="status" role="status" aria-live="polite"></p>
<section id="results" aria-label="Train departures"></section>
<p><small>Times are local to the railway (Japan). “Next day” indicates service after midnight. Check the operator for disruptions and timetable changes.</small></p>`, String.raw`
const form = document.getElementById("timetable-form");
const submit = document.getElementById("submit");
const status = document.getElementById("status");
const results = document.getElementById("results");
const date = document.getElementById("date");
const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
const part = (type) => parts.find((p) => p.type === type).value;
date.value = part("year") + "-" + part("month") + "-" + part("day");
function node(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
function time(value, nextDay) { return (value || "—") + (nextDay ? " (next day)" : ""); }
async function load(event) {
  if (event) event.preventDefault();
  if (submit.disabled || !form.reportValidity()) return;
  submit.disabled = true;
  results.replaceChildren();
  results.setAttribute("aria-busy", "true");
  status.textContent = "Loading timetable…";
  const query = new URLSearchParams({ date: date.value });
  const direction = document.getElementById("direction").value;
  const dayType = document.getElementById("day-type").value;
  if (direction) query.set("direction", direction);
  if (dayType) query.set("dayType", dayType);
  try {
    const response = await fetch("/api/lrt/timetable?" + query, { credentials: "omit", signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (response.status === 404) {
      status.textContent = "No timetable data is available for this schedule.";
      return;
    }
    if (!response.ok || !result.success) throw new Error("Timetable unavailable");
    let count = 0;
    for (const direction of result.data.directions) {
      results.append(node("h2", direction.direction === "INBOUND" ? "Inbound · toward Utsunomiya" : "Outbound · toward Haga"));
      for (const trip of direction.trips) {
        count++;
        const details = document.createElement("details");
        const served = trip.stops.filter((stop) => stop.stopType === "STOP");
        const origin = served[0];
        const destination = served[served.length - 1];
        const name = (stop) => stop ? (stop.stationNameEn || stop.stationName) : "—";
        details.append(node("summary", time(trip.firstDeparture, trip.firstDepartureNextDay) + " · " + name(origin) + " → " + name(destination) + " · " + trip.trainType));
        const scroll = node("div", "");
        scroll.className = "table-scroll";
        scroll.tabIndex = 0;
        scroll.setAttribute("role", "region");
        scroll.setAttribute("aria-label", "Train stops");
        const table = document.createElement("table");
        const head = document.createElement("thead");
        const header = document.createElement("tr");
        for (const label of ["Station", "Arrival", "Departure"]) {
          const cell = node("th", label); cell.scope = "col"; header.append(cell);
        }
        head.append(header); table.append(head);
        const body = document.createElement("tbody");
        for (const stop of trip.stops) {
          const row = document.createElement("tr");
          row.append(node("td", name(stop)));
          if (stop.stopType === "STOP") {
            row.append(node("td", time(stop.arrival, stop.isNextDay)), node("td", time(stop.departure, stop.isNextDay)));
          } else {
            row.append(node("td", stop.stopType === "PASS" ? "Passes" : "No service"), node("td", "—"));
          }
          body.append(row);
        }
        table.append(body); scroll.append(table); details.append(scroll); results.append(details);
      }
    }
    status.textContent = count ? result.data.date + " · " + (result.data.dayType === "WEEKDAY" ? "Weekday" : "Weekend / holiday") + " · " + count + " trains" : "No trains found for this schedule.";
  } catch {
    results.replaceChildren();
    status.textContent = "We could not load the timetable. Check your connection and try again.";
  } finally {
    submit.disabled = false;
    results.setAttribute("aria-busy", "false");
  }
}
form.addEventListener("submit", load);
void load();`);
}
