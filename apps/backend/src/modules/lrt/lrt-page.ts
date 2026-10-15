import type { Request, Response } from "express";
import { publicPage } from "../../utils/public-page";

export function lrtPage(_req: Request, res: Response): void {
  publicPage(res, "LRT timetable", `
<h1>LRT timetable</h1>
<p>Choose From and To stations to view matching trains, or leave both blank for the full timetable. Expand a train to see its stops. No account needed.</p>
<form id="timetable-form">
<label for="from">From station<select id="from" disabled><option value="">All stations</option></select></label>
<label for="to">To station<select id="to" disabled><option value="">All stations</option></select></label>
<label for="date">Travel date<input id="date" type="date" required></label>
<label for="direction">Direction (full timetable)<select id="direction"><option value="">Both directions</option><option value="INBOUND">Inbound · toward Utsunomiya</option><option value="OUTBOUND">Outbound · toward Haga</option></select></label>
<label for="day-type">Schedule<select id="day-type"><option value="">Automatic for date</option><option value="WEEKDAY">Weekday</option><option value="HOLIDAY">Weekend / holiday</option></select></label>
<button id="submit" type="submit">Show trains</button></form>
<p id="station-status" role="status" aria-live="polite">Loading stations…</p>
<p id="status" role="status" aria-live="polite"></p>
<section id="results" aria-label="Train departures"></section>
<p><small>Times are local to the railway (Japan). “Next day” indicates service after midnight. Check the operator for disruptions and timetable changes.</small></p>`, String.raw`
const form = document.getElementById("timetable-form");
const submit = document.getElementById("submit");
const status = document.getElementById("status");
const results = document.getElementById("results");
const date = document.getElementById("date");
const from = document.getElementById("from");
const to = document.getElementById("to");
const directionSelect = document.getElementById("direction");
const stationStatus = document.getElementById("station-status");
from.disabled = to.disabled = true;
function updateDirection() { directionSelect.disabled = Boolean(from.value || to.value); }
from.addEventListener("change", updateDirection);
to.addEventListener("change", updateDirection);
const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
const part = (type) => parts.find((p) => p.type === type).value;
date.value = part("year") + "-" + part("month") + "-" + part("day");
function node(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
function time(value, nextDay) { return (value || "—") + (nextDay ? " (next day)" : ""); }
function stopName(stop) { return stop ? (stop.stationNameEn || stop.stationName) : "—"; }
async function loadStations() {
  try {
    const response = await fetch("/api/lrt/stations", { credentials: "omit", signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error("Stations unavailable");
    for (const station of result.data.stations) {
      for (const select of [from, to]) {
        const option = node("option", station.nameEn ? station.nameEn + " · " + station.name : station.name);
        option.value = String(station.code);
        select.append(option);
      }
    }
    from.disabled = to.disabled = result.data.stations.length === 0;
    stationStatus.textContent = result.data.stations.length ? "" : "No station data is available. You can still browse the full timetable.";
  } catch {
    stationStatus.textContent = "We could not load stations. Reload this page to try again, or browse the full timetable.";
  }
}
async function load(event) {
  if (event) event.preventDefault();
  if (submit.disabled || !form.reportValidity()) return;
  const fromCode = from.value;
  const toCode = to.value;
  const route = Boolean(fromCode && toCode);
  results.replaceChildren();
  if ((fromCode || toCode) && !route) {
    status.textContent = "Choose both From and To stations, or leave both blank for the full timetable.";
    return;
  }
  if (route && fromCode === toCode) {
    status.textContent = "Choose two different stations.";
    return;
  }
  submit.disabled = true;
  results.setAttribute("aria-busy", "true");
  status.textContent = "Loading trains…";
  const query = new URLSearchParams({ date: date.value });
  const dayType = document.getElementById("day-type").value;
  if (route) {
    query.set("from", fromCode);
    query.set("to", toCode);
  } else if (directionSelect.value) {
    query.set("direction", directionSelect.value);
  }
  if (dayType) query.set("dayType", dayType);
  try {
    const response = await fetch((route ? "/api/lrt/search?" : "/api/lrt/timetable?") + query, { credentials: "omit", signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (response.status === 404) {
      status.textContent = route ? "No route data is available for these stations and schedule." : "No timetable data is available for this schedule.";
      return;
    }
    if (!response.ok || !result.success) throw new Error("Timetable unavailable");
    let count = 0;
    const directions = route ? [{ direction: result.data.direction, trips: result.data.trips }] : result.data.directions;
    for (const direction of directions) {
      const heading = direction.direction === "INBOUND" ? "Inbound · toward Utsunomiya" : "Outbound · toward Haga";
      results.append(node("h2", route ? (result.data.from.nameEn || result.data.from.name) + " → " + (result.data.to.nameEn || result.data.to.name) + " · " + heading : heading));
      for (const trip of direction.trips) {
        count++;
        const details = document.createElement("details");
        const served = trip.stops.filter((stop) => stop.stopType === "STOP");
        const origin = served[0];
        const destination = served[served.length - 1];
        details.append(node("summary", route
          ? time(trip.from.time, trip.from.isNextDay) + " · " + stopName(trip.from) + " → " + stopName(trip.to) + " · arrives " + time(trip.to.time, trip.to.isNextDay) + " · " + trip.durationMins + " min · " + trip.trainType
          : time(trip.firstDeparture, trip.firstDepartureNextDay) + " · " + stopName(origin) + " → " + stopName(destination) + " · " + trip.trainType));
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
        let stops = trip.stops;
        if (route) {
          const fromIndex = stops.findIndex((stop) => stop.stationCode === trip.from.stationCode);
          const toIndex = stops.findIndex((stop) => stop.stationCode === trip.to.stationCode);
          stops = stops.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1);
          if (fromIndex > toIndex) stops.reverse();
        }
        for (const stop of stops) {
          const row = document.createElement("tr");
          row.append(node("td", stopName(stop)));
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
    status.textContent = count ? result.data.date + " · " + (result.data.dayType === "WEEKDAY" ? "Weekday" : "Weekend / holiday") + " · " + count + " trains" : route ? "No trains found between these stations for this schedule." : "No trains found for this schedule.";
  } catch {
    results.replaceChildren();
    status.textContent = "We could not load the trains. Check your connection and try again.";
  } finally {
    submit.disabled = false;
    results.setAttribute("aria-busy", "false");
  }
}
form.addEventListener("submit", load);
void loadStations();
void load();`);
}
