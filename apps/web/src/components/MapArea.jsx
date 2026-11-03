import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILE_URL =
  import.meta.env.VITE_MAPS_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export function MapArea({ center = [12.97, 77.59], radiusMeters = 800, className = 'h-48' }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [center[1], center[0]], // Leaflet uses [lat, lng]
        zoom: 14,
        zoomControl: false,
        attributionControl: true,
      });

      L.tileLayer(TILE_URL, {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      // Draw an approximate privacy circle rather than an exact pinpoint
      L.circle([center[1], center[0]], {
        radius: radiusMeters,
        color: '#0d9488',
        fillColor: '#0d9488',
        fillOpacity: 0.15,
        weight: 1.5,
      }).addTo(map);

      mapInstanceRef.current = map;
    } else {
      mapInstanceRef.current.setView([center[1], center[0]], 14);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [center, radiusMeters]);

  return (
    <div
      className={`w-full rounded-brand overflow-hidden relative border border-slate-200 ${className}`}
    >
      <div ref={mapContainerRef} className="w-full h-full z-0" />
      <div className="absolute top-2 left-2 z-10 bg-white/90 backdrop-blur-xs px-2 py-0.5 rounded text-[10px] font-medium text-slate-700 shadow-xs border border-slate-200">
        Approximate Area
      </div>
    </div>
  );
}

export default MapArea;
