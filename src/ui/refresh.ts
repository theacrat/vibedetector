import { useEffect, useEffectEvent, useState } from "react";

export function usePublicRefresh(refresh: () => Promise<void>) {
  const [error, setError] = useState("");
  const tick = useEffectEvent(async () => {
    try {
      await refresh();
      setError("");
    } catch {
      setError("Live updates are unavailable. Please refresh to try again.");
    }
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      void tick();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return error;
}
