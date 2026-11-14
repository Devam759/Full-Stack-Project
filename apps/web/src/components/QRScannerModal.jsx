/**
 * @file apps/web/src/components/QRScannerModal.jsx
 * Modal providing camera stream scanner and manual 6-digit fallback code entry.
 * Collects GPS coordinates for haversine proximity check; only surfaces "nearby" or "too far".
 */

import React, { useState, useRef, useEffect } from 'react';
import { X, Camera, KeyRound, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import api from '../api/client.js';

export default function QRScannerModal({ isOpen, onClose, bookingId, type = 'pickup', onSuccess }) {
  const [activeTab, setActiveTab] = useState('camera'); // 'camera' | 'code'
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [distanceInfo, setDistanceInfo] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const title = type === 'pickup' ? 'Scan Pickup QR' : 'Scan Return QR';

  // Request camera stream when in camera mode
  useEffect(() => {
    if (!isOpen || activeTab !== 'camera') {
      stopCamera();
      return;
    }

    startCamera();
    return () => stopCamera();
  }, [isOpen, activeTab]);

  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }
    } catch {
      // Camera permission denied or unsupported - suggest fallback code
      setError('Camera access unavailable. Please use the 6-digit fallback code.');
      setActiveTab('code');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // Helper to get GPS coordinates
  const getCoordinates = async () => {
    try {
      if ('geolocation' in navigator) {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 5000,
          });
        });
        return {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        };
      }
    } catch {
      // Ignored: geo fallback code is available
    }
    return {};
  };

  // Submit manual 6-digit fallback code
  const handleCodeSubmit = async (e) => {
    e?.preventDefault();
    if (code.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const endpoint =
        type === 'pickup'
          ? `/bookings/${bookingId}/handover/code`
          : `/bookings/${bookingId}/return/code`;

      const rand = Math.random().toString(36).slice(2);
      const res = await api.post(
        endpoint,
        { code },
        {
          headers: {
            'Idempotency-Key': `ik_code_${Date.now()}_${rand}`,
          },
        },
      );

      setSuccess(true);
      setTimeout(() => {
        onSuccess?.(res);
        onClose();
      }, 1000);
    } catch (err) {
      if (err.data?.attemptsRemaining !== undefined) {
        setError(
          `Invalid code. ${err.data.attemptsRemaining} attempt(s) remaining before lockout.`,
        );
      } else if (err.code === 'HANDOVER_LOCKED') {
        setError('Too many failed attempts. Entry is locked for 15 minutes.');
      } else {
        setError(err.message || 'Verification failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle scanned QR token
  const _handleTokenScanned = async (token) => {
    try {
      setLoading(true);
      setError(null);

      const coords = await getCoordinates();
      const endpoint =
        type === 'pickup'
          ? `/bookings/${bookingId}/handover/scan`
          : `/bookings/${bookingId}/return/scan`;

      const rand = Math.random().toString(36).slice(2);
      const res = await api.post(
        endpoint,
        {
          qrToken: token,
          ...coords,
        },
        {
          headers: {
            'Idempotency-Key': `ik_scan_${Date.now()}_${rand}`,
          },
        },
      );

      setSuccess(true);
      setDistanceInfo('nearby');
      setTimeout(() => {
        onSuccess?.(res);
        onClose();
      }, 1000);
    } catch (err) {
      if (err.code === 'HANDOVER_TOO_FAR') {
        setError('Location check failed: parties are too far apart for handover.');
        setDistanceInfo('too far');
      } else {
        setError(err.message || 'QR verification failed');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl relative border border-zinc-100">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-zinc-600 rounded-full hover:bg-zinc-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-lg font-bold text-zinc-900 mb-1">{title}</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Point your camera at the other party&apos;s screen or enter the 6-digit code.
        </p>

        {/* Tab Selector */}
        <div className="flex border-b border-zinc-200 mb-4">
          <button
            onClick={() => {
              setActiveTab('camera');
              setError(null);
            }}
            className={`flex-1 pb-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition ${
              activeTab === 'camera'
                ? 'border-brand text-brand'
                : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Camera Scan</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('code');
              setError(null);
            }}
            className={`flex-1 pb-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition ${
              activeTab === 'code'
                ? 'border-brand text-brand'
                : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>6-Digit Code</span>
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success ? (
          <div className="py-8 text-center text-emerald-600 animate-fade-in">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-emerald-500" />
            <div className="font-bold text-base">Verified Successfully!</div>
            {distanceInfo && (
              <div className="text-xs text-zinc-400 mt-1">Proximity verified ({distanceInfo})</div>
            )}
          </div>
        ) : activeTab === 'camera' ? (
          <div className="space-y-3">
            <div className="relative aspect-square bg-zinc-900 rounded-2xl overflow-hidden flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-8 border-2 border-brand/80 rounded-xl pointer-events-none animate-pulse" />
              {loading && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              )}
            </div>
            <button
              onClick={() => setActiveTab('code')}
              className="w-full py-2 text-xs font-medium text-zinc-500 hover:text-zinc-800 transition"
            >
              Camera not scanning? Use 6-digit code instead
            </button>
          </div>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Enter 6-Digit Code
              </label>
              <input
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand font-black"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full py-2.5 px-4 bg-brand text-white rounded-xl font-medium text-sm hover:bg-brand-dark transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Verify & Complete</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
