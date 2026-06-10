import type { ForecastDay } from "../../shared/types";
import { bestRemainingWindow } from "../../shared/candidates";
import { SPOT_DISPLAY } from "../../shared/spots";
import "./NowBanner.css";

interface NowBannerProps {
  day: ForecastDay;
}

function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Today-only: the best remaining surf window from the current hour onwards.
// Uses device time — the app's user is on-site in Pacitan (WIB), a deliberate
// simplification.
export function NowBanner({ day }: NowBannerProps) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Nothing useful to say before dawn or after sunset.
  if (nowMin < parseHHmm(day.astronomy.sunrise) - 60 || nowMin >= parseHHmm(day.astronomy.sunset)) {
    return null;
  }

  const win = bestRemainingWindow(day, now.getHours());

  if (!win) {
    return <div className="now-banner none">No more surf windows today</div>;
  }

  const display = SPOT_DISPLAY.find((s) => s.key === win.spot)!;
  const running = nowMin >= parseHHmm(win.start);
  const isGreen = win.greens > 0;

  return (
    <div className={`now-banner ${isGreen ? "good" : "marginal"}`}>
      <span className="now-banner-label">{running ? "Now:" : "Best window from now:"}</span>
      <span className="now-banner-window">
        {display.emoji} {display.label} {win.start}–{win.end}
      </span>
    </div>
  );
}
