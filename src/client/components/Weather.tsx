import type { WeatherData } from "../../../shared/types";
import "./Weather.css";

interface WeatherProps {
  weather: WeatherData;
}

const CONDITION_LABELS: Record<string, string> = {
  clear: "Clear",
  partly_cloudy: "Partly Cloudy",
  cloudy: "Cloudy",
  rain: "Rain",
  thunderstorm: "Thunderstorm",
  fog: "Fog",
};

function formatCondition(condition: string): string {
  return CONDITION_LABELS[condition] ?? condition.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Weather({ weather }: WeatherProps) {
  return (
    <div className="weather">
      {/* Temp */}
      <div className="weather-card">
        <div className="weather-card-label">Temp</div>
        <div className="weather-card-value">{weather.temp}°C</div>
      </div>

      {/* Condition */}
      <div className="weather-card">
        <div className="weather-card-label">Sky</div>
        <div className="weather-card-text">{formatCondition(weather.condition)}</div>
      </div>

      {/* Rain */}
      <div className="weather-card">
        <div className="weather-card-label">Rain</div>
        <div className="weather-card-value">
          {weather.precipitation} <span className="weather-card-unit">mm</span>
        </div>
      </div>
    </div>
  );
}
