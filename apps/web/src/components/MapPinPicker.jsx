/**
 * @file apps/web/src/components/MapPinPicker.jsx
 * Interactive Leaflet map pin dropper for proposing handover meeting locations.
 */

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, X } from 'lucide-react';

const TILE_URL =
  import.meta.env.VITE_MAPS_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export function MapPinPicker({ initialCenter = [12.9716, 77.5946], onSelectPin, onCancel }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  const [selectedCoord, setSelectedCoord] = useState({
    lat: initialCenter[0],
    lng: initialCenter[1],
  });
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [initialCenter[0], initialCenter[1]],
        zoom: 14,
        attributionControl: true,
      });

      L.tileLayer(TILE_URL, {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      // Create initial marker
      const marker = L.marker([initialCenter[0], initialCenter[1]], {
        draggable: true,
      }).addTo(map);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        setSelectedCoord({ lat: pos.lat, lng: pos.lng });
      });

      markerRef.current = marker;

      // Click to move marker
      map.on('click', (e) => {
        marker.setLatLng(e.latlng);
        setSelectedCoord({ lat: e.latlng.lat, lng: e.latlng.lng });
      });

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [initialCenter]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!label.trim()) {
      setError('Please provide a meeting place label (e.g. Metro Gate 2)');
      return;
    }
    if (label.length > 100) {
      setError('Label cannot exceed 100 characters');
      return;
    }
    setError('');
    onSelectPin({
      lat: Number(selectedCoord.lat.toFixed(6)),
      lng: Number(selectedCoord.lng.toFixed(6)),
      label: label.trim(),
    });
  };

  return (
    <div
      data-testid="map-pin-picker-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-800 font-semibold">
            <MapPin className="w-5 h-5 text-brand-600" />
            <span>Propose Handover Meeting Place</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex-1 flex flex-col gap-3">
          <p className="text-xs text-slate-600">
            Click on the map or drag the pin to choose an agreed public meeting location.
          </p>

          <div
            ref={mapContainerRef}
            className="w-full h-64 rounded-xl border border-slate-200 overflow-hidden relative z-0"
          />

          <div className="text-[11px] text-slate-500 font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            Coordinates: {selectedCoord.lat.toFixed(5)}, {selectedCoord.lng.toFixed(5)}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-1">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Meeting Place Label <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Metro Station Exit B, Library Lobby"
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-brand-500"
                maxLength={100}
                required
              />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg shadow-xs"
              >
                Send Meeting Pin
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default MapPinPicker;
