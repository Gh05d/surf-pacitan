import { useRef, useEffect, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./SpotMap.css";
import { SPOT_DISPLAY } from "../../shared/spots";

function createSpotIcon(emoji: string) {
  return L.divIcon({
    className: "spot-marker",
    html: emoji,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

const SPOTS = [
  { name: "Teleng Ria", lat: -8.2230, lng: 111.0790, desc: "Mellow beachbreak, beginner friendly", emoji: SPOT_DISPLAY.find((s) => s.key === "telengRia")!.emoji },
  { name: "Pancer", lat: -8.2215, lng: 111.0880, desc: "Beachbreak, lefts & rights", emoji: SPOT_DISPLAY.find((s) => s.key === "pancer")!.emoji },
  { name: "Pancer Door", lat: -8.2298, lng: 111.1026, desc: "River mouth sandbar, left", emoji: SPOT_DISPLAY.find((s) => s.key === "pancerDoor")!.emoji },
];

const DEFAULT_CENTER: L.LatLngExpression = [-8.227, 111.088];
const DEFAULT_ZOOM = 14;
const FLY_TO_ZOOM = 15;

export function SpotMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const locationMarkerRef = useRef<L.Marker | null>(null);
  const [activeSpot, setActiveSpot] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);

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
      marker.bindPopup(`<strong>${spot.name}</strong><br>${spot.desc}`);
      return marker;
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
