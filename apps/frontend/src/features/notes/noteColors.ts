import type { NoteColor } from "../../api/types";

interface NoteColorOption {
  value: NoteColor;
  label: string;
  swatch: string;
  surface: string;
}

export const NOTE_COLOR_OPTIONS: NoteColorOption[] = [
  {
    value: "DEFAULT",
    label: "Default",
    swatch: "bg-slate-300",
    surface: "bg-white/[0.055] border-white/10",
  },
  {
    value: "RED",
    label: "Red",
    swatch: "bg-red-400",
    surface: "bg-red-500/[0.09] border-red-400/20",
  },
  {
    value: "ORANGE",
    label: "Orange",
    swatch: "bg-orange-400",
    surface: "bg-orange-500/[0.09] border-orange-400/20",
  },
  {
    value: "YELLOW",
    label: "Yellow",
    swatch: "bg-yellow-300",
    surface: "bg-yellow-400/[0.09] border-yellow-300/20",
  },
  {
    value: "GREEN",
    label: "Green",
    swatch: "bg-emerald-400",
    surface: "bg-emerald-500/[0.09] border-emerald-400/20",
  },
  {
    value: "TEAL",
    label: "Teal",
    swatch: "bg-teal-400",
    surface: "bg-teal-500/[0.09] border-teal-400/20",
  },
  {
    value: "BLUE",
    label: "Blue",
    swatch: "bg-sky-400",
    surface: "bg-sky-500/[0.09] border-sky-400/20",
  },
  {
    value: "PURPLE",
    label: "Purple",
    swatch: "bg-violet-400",
    surface: "bg-violet-500/[0.09] border-violet-400/20",
  },
  {
    value: "PINK",
    label: "Pink",
    swatch: "bg-pink-400",
    surface: "bg-pink-500/[0.09] border-pink-400/20",
  },
  {
    value: "BROWN",
    label: "Brown",
    swatch: "bg-amber-700",
    surface: "bg-amber-800/[0.13] border-amber-600/25",
  },
  {
    value: "GRAY",
    label: "Gray",
    swatch: "bg-zinc-400",
    surface: "bg-zinc-500/[0.1] border-zinc-400/20",
  },
];

export function noteColorOption(color: NoteColor): NoteColorOption {
  return NOTE_COLOR_OPTIONS.find((option) => option.value === color)!;
}
