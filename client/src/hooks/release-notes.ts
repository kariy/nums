import { useCallback, useState } from "react";
import { RELEASE_NOTES_VERSION } from "@/data/release-notes";

const RELEASE_NOTES_KEY = "nums-release-notes-version";

export const useReleaseNotes = () => {
  const [seen, setSeen] = useState<boolean>(
    () => localStorage.getItem(RELEASE_NOTES_KEY) === RELEASE_NOTES_VERSION,
  );

  const acknowledge = useCallback(() => {
    localStorage.setItem(RELEASE_NOTES_KEY, RELEASE_NOTES_VERSION);
    setSeen(true);
  }, []);

  return { seen, acknowledge };
};
