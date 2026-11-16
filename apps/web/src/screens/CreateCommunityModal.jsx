import React, { useState } from 'react';
import { X, Users, Globe, Lock, AlertCircle } from 'lucide-react';
import { apiRequest } from '../api/client.js';

export function CreateCommunityModal({
  onClose,
  onSuccess,
  initialLocation = [77.59, 12.97],
  initialCity = 'Bengaluru',
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('public');
  const [city, setCity] = useState(initialCity);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiRequest('/communities', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          type,
          city: city.trim(),
          location: {
            type: 'Point',
            coordinates: initialLocation,
          },
        }),
      });

      if (onSuccess) {
        onSuccess(data.community);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create community');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 space-y-5 shadow-2xl border border-neutral-200">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-black" />
            <h2 className="text-lg font-heading font-black text-black tracking-tight">
              Create a community
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-black rounded-full hover:bg-neutral-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
              Community Name
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Green Glen Layout, IIT Delhi Campus"
              className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
              City / Region
            </label>
            <input
              type="text"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. New Delhi"
              className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
              Description
            </label>
            <textarea
              maxLength={500}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell members about this neighborhood, hostel, or campus group..."
              className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none resize-none transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-2">
              Access Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`p-3.5 border rounded-2xl flex items-start gap-2.5 cursor-pointer transition ${
                  type === 'public'
                    ? 'border-black bg-neutral-50 text-black shadow-xs'
                    : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value="public"
                  checked={type === 'public'}
                  onChange={() => setType('public')}
                  className="mt-0.5 accent-black"
                />
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-xs text-black">
                    <Globe className="w-3.5 h-3.5" />
                    <span>Public</span>
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-0.5">Anyone can join instantly</p>
                </div>
              </label>

              <label
                className={`p-3.5 border rounded-2xl flex items-start gap-2.5 cursor-pointer transition ${
                  type === 'private'
                    ? 'border-black bg-neutral-50 text-black shadow-xs'
                    : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value="private"
                  checked={type === 'private'}
                  onChange={() => setType('private')}
                  className="mt-0.5 accent-black"
                />
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-xs text-black">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Private</span>
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-0.5">Join via approval or code</p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-neutral-100 hover:bg-neutral-200 text-black rounded-full text-xs font-bold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-black hover:bg-neutral-800 text-white rounded-full text-xs font-bold transition shadow-xs disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create community'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateCommunityModal;
