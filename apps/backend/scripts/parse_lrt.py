#!/usr/bin/env python3
"""
Parse the four LRT timetable PDFs in ./lrt into a structured JSON file.

Output: prisma/lrt-data.json
"""
import json
import os
import re
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
LRT_DIR = ROOT / "lrt"
OUT_FILE = ROOT / "prisma" / "lrdata.json"

# ── Canonical station list (inbound order, Utsunomiya-bound) ────────────────
# code: inbound order (0..18). Outbound visit order is reversed.
STATIONS = [
    ("芳賀・高根沢工業団地",            "Haga-Takanezawa Industrial Park", "haga-takanezawa-kogyo-danchi"),
    ("かしの森公園前",                  "Kashinomori Park",                 "kashinomori-koen-mae"),
    ("芳賀町工業団地管理センター前",    "Haga Industrial Park Mgmt Center", "haga-machi-kogyo-danchi-kanri-center-mae"),
    ("芳賀台",                          "Hagadai",                           "hagadai"),
    ("ゆいの杜東",                      "Yui-no-mori East",                  "yui-no-mori-higashi"),
    ("ゆいの杜中央",                    "Yui-no-mori Central",               "yui-no-mori-chuo"),
    ("ゆいの杜西",                      "Yui-no-mori West",                  "yui-no-mori-nishi"),
    ("グリーンスタジアム前",            "Green Stadium",                     "green-stadium-mae"),
    ("清原地区市民センター前",          "Kiyohara Community Center",         "kiyohara-chiku-shimin-center-mae"),
    ("清陵高校前",                      "Seiryo High School",               "seiryo-koko-mae"),
    ("飛山城跡",                        "Hiyama Castle Ruins",              "hiyama-jo-ato"),
    ("平石中央小学校前",                "Hiraishi Central Elementary",      "hiraishi-chuo-shogakko-mae"),
    ("平石",                            "Hiraishi",                          "hiraishi"),
    ("宇都宮大学陽東キャンパス",        "Utsunomiya Univ Yoto Campus",      "utsunomiya-daigaku-yoto-campus"),
    ("陽東３丁目",                      "Yoto 3-chome",                      "yoto-3-chome"),
    ("峰",                              "Mine",                              "mine"),
    ("駅東公園前",                      "Ekito Park",                        "ekito-koen-mae"),
    ("東宿郷",                          "Higashi-Shukugo",                   "higashi-shukugo"),
    ("宇都宮駅東口",                    "Utsunomiya Station East Exit",      "utsunomiya-eki-higashiguchi"),
]
NAME_TO_CODE = {name: i for i, (name, _, _) in enumerate(STATIONS)}
N_STATIONS = len(STATIONS)  # 19

TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")

def parse_time(s):
    """Return minutes-from-midnight int, or None if not a time cell."""
    if s is None:
        return None
    s = s.strip()
    m = TIME_RE.match(s)
    if not m:
        return None
    h, mm = int(m.group(1)), int(m.group(2))
    if mm >= 60 or h >= 30:  # sanity; LRT times are 0..29h at most
        return None
    return h * 60 + mm

def is_pass(s):
    """Rapid-train pass marker (small katakana レ / ㇾ)."""
    return s is not None and s.strip() in ("ㇾ", "レ")

def is_noservice(s):
    if s is None:
        return True
    s = s.strip()
    return s == "" or s == "…" or s == "..."

def classify_label(label):
    """
    Returns (kind, name) where kind in:
      ORIGIN_DEP  - single row, ends with 発 (only departure matters)
      DEST_ARR    - single row, ends with 着 (only arrival matters)
      BOTH        - middle stop, ends with 〃 (arrival == departure)
      ARR_DUAL    - '着\\n<name>\\n発' arrival row of a dual station
      DEP_CONT    - None label, departure continuation of previous dual station
    """
    if label is None:
        return ("DEP_CONT", None)
    lab = label.strip()
    if lab == "":
        return ("DEP_CONT", None)
    if "\n" in lab:
        parts = [p.strip() for p in lab.split("\n") if p.strip()]
        if parts and parts[0] == "着" and parts[-1] == "発":
            name = "".join(parts[1:-1])
            return ("ARR_DUAL", name)
        # unexpected multiline label
        return ("BOTH", lab.replace("\n", ""))
    if lab.endswith(" 発") or lab.endswith("発"):
        name = re.sub(r"\s*発\s*$", "", lab)
        return ("ORIGIN_DEP", name)
    if lab.endswith(" 着") or lab.endswith("着"):
        name = re.sub(r"\s*着\s*$", "", lab)
        return ("DEST_ARR", name)
    # middle stop with 〃 ditto marker
    name = re.sub(r"\s*〃\s*$", "", lab)
    return ("BOTH", name)

def parse_pdf(path):
    """Return list of station-rows for each half: [{name, kind, cells:[...]}, ...]"""
    with pdfplumber.open(path) as pdf:
        tables = pdf.pages[0].find_tables()
        if not tables:
            raise RuntimeError(f"No table found in {path}")
        rows = tables[0].extract()
    # find '列車名' rows -> half starts
    half_starts = [i for i, r in enumerate(rows) if r and r[0] and r[0].strip() == "列車名"]
    if len(half_starts) != 2:
        raise RuntimeError(f"Expected 2 '列車名' rows in {path}, got {len(half_starts)}")
    halves = []
    for hi, start in enumerate(half_starts):
        end = half_starts[hi + 1] if hi + 1 < len(half_starts) else len(rows)
        train_types = rows[start][1:]
        data_rows = rows[start + 1: end]
        # drop fully-empty trailing rows (separator / title)
        data_rows = [r for r in data_rows if any(c is not None and str(c).strip() != "" for c in r)]
        station_rows = []
        last_dual_name = None
        for r in data_rows:
            kind, name = classify_label(r[0])
            if kind == "DEP_CONT":
                if last_dual_name is None:
                    continue  # orphan, skip
                station_rows.append({"name": last_dual_name, "kind": "DEP_CONT", "cells": r[1:]})
            elif kind == "ARR_DUAL":
                last_dual_name = name
                station_rows.append({"name": name, "kind": "ARR_DUAL", "cells": r[1:]})
            else:
                station_rows.append({"name": name, "kind": kind, "cells": r[1:]})
        halves.append({"train_types": train_types, "rows": station_rows})
    return halves

def merge_stations(rows):
    """
    Merge arrival/departure rows into an ordered list of unique stations:
    [ {name, arr:[...], dep:[...]}, ... ] in visit order.
    arr/dep are per-column cell strings (raw).
    """
    order = []
    by_name = {}
    for r in rows:
        nm = r["name"]
        kind = r["kind"]
        if nm not in by_name:
            rec = {"name": nm, "arr": None, "dep": None}
            by_name[nm] = rec
            order.append(rec)
        rec = by_name[nm]
        if kind == "ARR_DUAL":
            rec["arr"] = r["cells"]
        elif kind == "DEP_CONT":
            rec["dep"] = r["cells"]
        elif kind == "ORIGIN_DEP":
            rec["dep"] = r["cells"]
        elif kind == "DEST_ARR":
            rec["arr"] = r["cells"]
        else:  # BOTH
            rec["arr"] = r["cells"]
            rec["dep"] = r["cells"]
    # For BOTH/ORIGIN/DEST, ensure arr+dep correct:
    # BOTH -> arr==dep (same). ORIGIN -> dep only (arr stays None). DEST -> arr only.
    return order

def build_trips(halves, day_type, direction):
    """Convert two halves (AM,PM) of station-rows into trip records."""
    trips = []
    ncol = None
    for half_idx, half in enumerate(halves):
        merged = merge_stations(half["rows"])
        # column count = length of the train-types header row
        ncols = len(half["train_types"])
        period = "AM" if half_idx == 0 else "PM"
        for col in range(ncols):
            stops = []
            has_real = False
            for rec in merged:  # in visit order
                arr_cell = rec["arr"][col] if rec["arr"] and col < len(rec["arr"]) else None
                dep_cell = rec["dep"][col] if rec["dep"] and col < len(rec["dep"]) else None
                arr_m = parse_time(arr_cell)
                dep_m = parse_time(dep_cell)
                if arr_m is not None or dep_m is not None:
                    has_real = True
                    stop_type = "STOP"
                elif is_pass(arr_cell) or is_pass(dep_cell):
                    stop_type = "PASS"
                else:
                    stop_type = "NOSERVICE"
                stops.append({
                    "name": rec["name"],
                    "arr": arr_m,
                    "dep": dep_m,
                    "stopType": stop_type,
                })
            if not has_real:
                continue  # empty padding column
            ttype_raw = half["train_types"][col] if col < len(half["train_types"]) else "各停"
            train_type = "RAPID" if (ttype_raw and "快速" in ttype_raw) else "LOCAL"
            # first departure = time at the first stop this train actually serves
            # (its origin). NOT min() of all stops, because post-midnight middle-stop
            # times would otherwise be smaller than the true origin departure.
            first_dep = None
            for s in stops:
                t = s["dep"] if s["dep"] is not None else s["arr"]
                if t is not None:
                    first_dep = t
                    break
            if first_dep is None:
                first_dep = 0
            trips.append({
                "period": period,
                "trainType": train_type,
                "firstDepartMins": first_dep,
                "stops": stops,
            })
    # sort by first departure ascending; tie-break by period (AM before PM handled by time)
    trips.sort(key=lambda t: (t["firstDepartMins"], 0 if t["period"] == "AM" else 1))
    # assign tripIndex
    for i, t in enumerate(trips):
        t["tripIndex"] = i
        t["dayType"] = day_type
        t["direction"] = direction
    # next-day: a stop time that is much earlier than the origin departure means
    # the train crossed midnight. Mark those for display + effective sorting.
    for t in trips:
        ref = t["firstDepartMins"]
        for s in t["stops"]:
            s["arrNextDay"] = bool(s["arr"] is not None and s["arr"] < ref and (ref - s["arr"]) > 120)
            s["depNextDay"] = bool(s["dep"] is not None and s["dep"] < ref and (ref - s["dep"]) > 120)
    return trips

def main():
    files = {
        ("WEEKDAY", "INBOUND"):  "inbound-weekday-20260401.pdf",
        ("HOLIDAY", "INBOUND"):   "inbound-holiday-20260401.pdf",
        ("WEEKDAY", "OUTBOUND"):  "outbound-weekday-20260401.pdf",
        ("HOLIDAY", "OUTBOUND"):  "outbound-holiday-20260401.pdf",
    }
    all_trips = []
    summary = {}
    for (day_type, direction), fname in sorted(files.items()):
        path = LRT_DIR / fname
        halves = parse_pdf(path)
        trips = build_trips(halves, day_type, direction)
        all_trips.extend(trips)
        summary[f"{day_type}/{direction}"] = len(trips)
    # map station names -> codes; fail if unknown
    for t in all_trips:
        for s in t["stops"]:
            code = NAME_TO_CODE.get(s["name"])
            if code is None:
                raise RuntimeError(f"Unknown station name: {s['name']!r}")
            s["stationCode"] = code
            # stopSequence = visit index, computed in TS side from direction
    out = {
        "generatedAt": "2026-04-01",
        "revision": "2026-04-01",
        "stations": [
            {"code": i, "name": n, "nameEn": en, "nameRomaji": rm}
            for i, (n, en, rm) in enumerate(STATIONS)
        ],
        "trips": all_trips,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("Wrote", OUT_FILE)
    print("Summary:", summary)
    print("Total trips:", len(all_trips))
    # quick distribution of stops per train type
    rapid = sum(1 for t in all_trips if t["trainType"] == "RAPID")
    print("Rapid trips:", rapid, "Local trips:", len(all_trips) - rapid)

if __name__ == "__main__":
    main()