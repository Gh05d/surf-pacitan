import { useState } from "react";
import type { Recommendation } from "../../shared/types";
import { SPOT_DISPLAY } from "../../shared/spots";
import { todayLocal } from "../../shared/time";
import { ACTIVE_REGION } from "../../shared/active-region";
import "./RecommendationCard.css";

interface RecommendationCardProps {
  recommendation: Recommendation;
}

function findSpotDisplay(key: Recommendation["bestSpot"]) {
  return SPOT_DISPLAY.find((s) => s.key === key) ?? SPOT_DISPLAY[0];
}

function eyebrowFor(forDate: string): string {
  return forDate === todayLocal(ACTIVE_REGION.timezone)
    ? "🌅 Recommendation for today"
    : "🌅 Recommendation for tomorrow";
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
          {recommendation.overrideReason && (
            <p className="recommendation-card-override">
              ⤷ Differs from the top-rated window: {recommendation.overrideReason}
            </p>
          )}
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
