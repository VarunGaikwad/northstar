import { useEffect, useState } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { isGreetingPreference, nextGreetingLanguage, type GreetingPreference } from "../utils/greetings";

export function useGreetingLanguage() {
  const [stored, setPreference] = useLocalStorage<GreetingPreference>("greeting.language", "shuffle");
  const preference = isGreetingPreference(stored) ? stored : "shuffle";
  const [shuffledLanguage, setShuffledLanguage] = useState(() => nextGreetingLanguage());

  useEffect(() => {
    if (preference !== "shuffle") return;
    const id = setInterval(() => setShuffledLanguage((current) => nextGreetingLanguage(current)), 30_000);
    return () => clearInterval(id);
  }, [preference]);

  return { preference, setPreference, language: preference === "shuffle" ? shuffledLanguage : preference };
}
