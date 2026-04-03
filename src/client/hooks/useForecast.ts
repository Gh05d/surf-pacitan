import { useState, useEffect, useCallback, useRef } from "react";
import type { ForecastDay } from "../../shared/types";

interface UseForecastResult {
  days: ForecastDay[];
  lastFetch: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const REFETCH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function useForecast(): UseForecastResult {
  const [days, setDays] = useState<ForecastDay[]>([]);
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchForecast = useCallback(async () => {
    try {
      const res = await fetch("/api/forecast");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDays(data.days ?? []);
      setLastFetch(data.lastFetch ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load forecast");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
    } catch {
      // ignore refresh errors — still re-fetch
    }
    await fetchForecast();
  }, [fetchForecast]);

  useEffect(() => {
    fetchForecast();

    intervalRef.current = setInterval(fetchForecast, REFETCH_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchForecast]);

  return { days, lastFetch, loading, error, refresh };
}
