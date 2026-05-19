import { useState, useEffect } from "react";
import type { Recommendation, RecommendationResponse } from "../../shared/types";

interface UseRecommendationResult {
  enabled: boolean;
  recommendation: Recommendation | null;
  loading: boolean;
}

export function useRecommendation(): UseRecommendationResult {
  const [enabled, setEnabled] = useState(true);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/recommendation");
        if (!res.ok) {
          if (!cancelled) {
            setEnabled(false);
            setRecommendation(null);
          }
          return;
        }
        const data: RecommendationResponse = await res.json();
        if (cancelled) return;
        setEnabled(data.enabled);
        setRecommendation(data.recommendation);
      } catch {
        if (!cancelled) {
          setEnabled(false);
          setRecommendation(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { enabled, recommendation, loading };
}
