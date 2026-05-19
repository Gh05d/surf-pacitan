import { useState } from "react";
import type { Recommendation } from "../../shared/types";
import { SPOT_DISPLAY } from "../../shared/spots";
import "./RecommendationCard.css";

interface RecommendationCardProps {
  recommendation: Recommendation;
}

function findSpotDisplay(key: Recommendation["bestSpot"]) {
  return SPOT_DISPLAY.find((s) => s.key === key) ?? SPOT_DISPLAY[0];
}

// Asia/Jakarta local date — used to decide "heute" vs "morgen" labelling.
function todayWIB(): string {
  const now = new Date();
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = local.getUTCFullYear();
  const mo = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function eyebrowFor(forDate: string): string {
  return forDate === todayWIB() ? "🌅 Empfehlung für heute" : "🌅 Empfehlung für morgen";
}

export function RecommendationCard({ recommendation }: RecommendationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const spot = findSpotDisplay(recommendation.bestSpot);
  const { start, end } = recommendation.bestWindow;

  return (
    <section className="recommendation-card" aria-label="AI surf recommendation">
      <button
        className="recommendation-card-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="recommendation-card-header">
          <span className="recommendation-card-eyebrow">{eyebrowFor(recommendation.forDate)}</span>
        </div>
        <div className="recommendation-card-hero">
          <span className="recommendation-card-emoji">{spot.emoji}</span>
          <span className="recommendation-card-spot">{spot.label}</span>
          <span className="recommendation-card-window">{start}–{end}</span>
          <span className="recommendation-card-chevron">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="recommendation-card-body">
          <p className="recommendation-card-headline">{recommendation.headline}</p>
          <p className="recommendation-card-reasoning">{recommendation.reasoning}</p>
          {recommendation.warnings.length > 0 && (
            <ul className="recommendation-card-warnings">
              {recommendation.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
