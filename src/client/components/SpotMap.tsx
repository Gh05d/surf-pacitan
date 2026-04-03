import { useRef, useEffect, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./SpotMap.css";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const SPOTS = [
  { name: "Pancer Door", lat: -8.2295, lng: 111.0960, desc: "River mouth sandbar, left" },
  { name: "Pancer", lat: -8.2275, lng: 111.0880, desc: "Beachbreak, lefts & rights" },
  { name: "Teleng Ria", lat: -8.2260, lng: 111.0790, desc: "Mellow beachbreak, beginner friendly" },
];

const DEFAULT_CENTER: L.LatLngExpression = [-8.227, 111.088];
const DEFAULT_ZOOM = 14;
const FLY_TO_ZOOM = 17;

export function SpotMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const [activeSpot, setActiveSpot] = useState<number | null>(null);

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
      const marker = L.marker([spot.lat, spot.lng]).addTo(map);
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
      </div>
      <div className="spot-map-container" ref={containerRef} />
    </div>
  );
}
