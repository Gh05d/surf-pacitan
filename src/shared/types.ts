export interface TideExtreme {
  time: string; // HH:mm
  height: number; // meters
  type: "high" | "low";
}

export interface TideData {
  height: number; // meters relative to MSL
  rising: boolean;
}

export interface SwellData {
  height: number; // meters
  period: number; // seconds
  direction: number; // degrees, 0=N
}

export interface WindData {
  speed: number; // km/h
  direction: number; // degrees, 0=N
  gusts: number; // km/h
}

export interface WeatherData {
  temp: number; // Celsius
  condition: string; // "clear", "partly_cloudy", "cloudy", "rain", "thunderstorm", "fog"
  precipitation: number; // mm/h
}

export interface AstronomyData {
  sunrise: string; // HH:mm
  sunset: string; // HH:mm
}

export type SurfableRating = "green" | "yellow" | "red";

export type SpotName = "telengRia" | "pancer" | "pancerDoor";

export type SpotRatings = Record<SpotName, SurfableRating>;

export interface HourlyData {
  hour: number; // 0-23
  tide: TideData;
  swell: SwellData;
  wind: WindData;
  weather: WeatherData;
  surfable: SpotRatings;
}

export interface ForecastDay {
  date: string; // YYYY-MM-DD
  location: { name: string; lat: number; lng: number };
  astronomy: AstronomyData;
  tideExtremes: TideExtreme[];
  hourly: HourlyData[];
}

export interface ForecastResponse {
  days: ForecastDay[];
  lastFetch: string | null; // ISO timestamp
}

export interface StatusResponse {
  lastFetch: string | null;
  cachedDays: string[];
  stormglassQuota: number | null;
}

export interface RecommendationWindow {
  start: string; // "HH:mm" local time (Asia/Jakarta)
  end: string;   // "HH:mm"
}

export interface Recommendation {
  forDate: string;                  // YYYY-MM-DD — the day the recommendation is FOR
  generatedAt: string;              // ISO timestamp of generation
  bestSpot: SpotName;
  bestWindow: RecommendationWindow;
  headline: string;                 // 1 sentence summary, English
  reasoning: string;                // 2-3 sentences, English, <= 600 chars
  warnings: string[];               // empty array or short warning strings
  overrideReason?: string;          // only when deviating from the top candidate window, <= 300 chars
  modelUsed: string;                // e.g. "deepseek-v4-flash"
}

export interface RecommendationResponse {
  enabled: boolean;
  recommendation: Recommendation | null;
}
