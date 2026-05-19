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
          <span className="recommendation-card-eyebrow">🌅 Empfehlung für morgen</span>
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
