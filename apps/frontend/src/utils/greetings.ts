export const GREETING_LANGUAGES = {
  en: { label: "English", greetings: ["Good morning", "Good afternoon", "Good evening"] },
  hi: { label: "Hindi · हिन्दी", greetings: ["सुप्रभात", "शुभ दोपहर", "शुभ संध्या"] },
  ja: { label: "Japanese · 日本語", greetings: ["おはようございます", "こんにちは", "こんばんは"] },
  fr: { label: "French · Français", greetings: ["Bonjour", "Bon après-midi", "Bonsoir"] },
  es: { label: "Spanish · Español", greetings: ["Buenos días", "Buenas tardes", "Buenas noches"] },
} as const;

export type GreetingLanguage = keyof typeof GREETING_LANGUAGES;
export type GreetingPreference = "shuffle" | GreetingLanguage;
export const GREETING_LANGUAGE_CODES = Object.keys(GREETING_LANGUAGES) as GreetingLanguage[];

export function isGreetingPreference(value: unknown): value is GreetingPreference {
  return value === "shuffle" || GREETING_LANGUAGE_CODES.some((code) => code === value);
}

export function nextGreetingLanguage(current?: GreetingLanguage): GreetingLanguage {
  const choices = GREETING_LANGUAGE_CODES.filter((code) => code !== current);
  return choices[Math.floor(Math.random() * choices.length)];
}

export function greetingFor(hour: number, language: GreetingLanguage): string {
  return GREETING_LANGUAGES[language].greetings[hour < 12 ? 0 : hour < 18 ? 1 : 2];
}
