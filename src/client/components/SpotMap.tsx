import { useRef, useEffect, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./SpotMap.css";
import { ACTIVE_REGION } from "../../shared/active-region";
import type { SpotName } from "../../shared/types";

interface SpotMapProps {
  onSpotInfo: (spot: SpotName) => void;
}

function createSpotIcon(emoji: string) {
  return L.divIcon({
    className: "spot-marker",
    html: emoji,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

// Spot markers come from the active region pack, in pack order.
const SPOTS = ACTIVE_REGION.spots.map((s) => ({
  key: s.id as SpotName,
  name: s.label,
  lat: s.lat,
  lng: s.lng,
  desc: s.mapDesc,
  emoji: s.emoji,
}));

const DEFAULT_CENTER: L.LatLngExpression = ACTIVE_REGION.map.center;
const DEFAULT_ZOOM = ACTIVE_REGION.map.zoom;
const FLY_TO_ZOOM = DEFAULT_ZOOM + 1;

export function SpotMap({ onSpotInfo }: SpotMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const locationMarkerRef = useRef<L.Marker | null>(null);
  const [activeSpot, setActiveSpot] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  // The map effect runs once; route popup clicks through a ref so they always
  // see the current callback.
  const onSpotInfoRef = useRef(onSpotInfo);
  onSpotInfoRef.current = onSpotInfo;

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      scrollWheelZoom: false,
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Tiles &copy; Esri" }
    ).addTo(map);

    markersRef.current = SPOTS.map((spot) => {
      const marker = L.marker([spot.lat, spot.lng], { icon: createSpotIcon(spot.emoji) }).addTo(map);
      marker.bindPopup(
        `<strong>${spot.name}</strong><br>${spot.desc}<br>` +
        `<button class="spot-popup-details" data-spot="${spot.key}">Spot profile ↗</button>`,
      );
      return marker;
    });

    // Popup content is a Leaflet HTML string — wire the details button on open.
    map.on("popupopen", (e) => {
      const btn = e.popup.getElement()?.querySelector<HTMLButtonElement>(".spot-popup-details");
      if (!btn) return;
      btn.onclick = () => onSpotInfoRef.current(btn.dataset.spot as SpotName);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
    };
  }, []);

  function handleSpotClick(index: number) {
    const map = mapRef.current;
    if (!map) return;

    if (activeSpot === index) {
      // Toggle off — reset to default view
      map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM);
      setActiveSpot(null);
    } else {
      const spot = SPOTS[index];
      map.flyTo([spot.lat, spot.lng], FLY_TO_ZOOM);
      markersRef.current[index]?.openPopup();
      setActiveSpot(index);
    }
  }

  function handleLocateClick() {
    if (!mapRef.current || !navigator.geolocation || locationDenied) return;
    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const map = mapRef.current!;

        if (locationMarkerRef.current) {
          locationMarkerRef.current.setLatLng([latitude, longitude]);
        } else {
          locationMarkerRef.current = L.marker([latitude, longitude], {
            icon: L.divIcon({
              className: "location-marker",
              iconSize: [16, 16],
              iconAnchor: [8, 8],
            }),
          }).addTo(map);
        }
        setLocating(false);
      },
      () => {
        setLocationDenied(true);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="spot-map">
      <div className="spot-map-buttons">
        {SPOTS.map((spot, i) => (
          <button
            key={spot.name}
            className={`spot-btn${activeSpot === i ? " active" : ""}`}
            onClick={() => handleSpotClick(i)}
          >
            {spot.name}
          </button>
        ))}
        <button
          className={`spot-btn locate-btn${locationDenied ? " denied" : ""}`}
          onClick={handleLocateClick}
          disabled={locationDenied || locating}
        >
          {locating ? "…" : "📍"}
        </button>
      </div>
      <div className="spot-map-container" ref={containerRef} />
    </div>
  );
}
