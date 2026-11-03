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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-brand max-w-md w-full p-5 space-y-4 shadow-xl border border-slate-200">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-sm font-heading font-bold text-slate-900">Create a Community</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-brand text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Community Name
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Green Glen Layout, Koramangala"
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">City / Region</label>
            <input
              type="text"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Bengaluru"
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
            <textarea
              maxLength={500}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell members about this neighborhood, hostel, or campus group..."
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Access Type</label>
            <div className="grid grid-cols-2 gap-2">
              <label
                className={`p-2.5 border rounded-brand flex items-start gap-2 cursor-pointer transition ${
                  type === 'public'
                    ? 'border-primary bg-teal-50/50 text-primary-dark'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value="public"
                  checked={type === 'public'}
                  onChange={() => setType('public')}
                  className="mt-0.5"
                />
                <div>
                  <div className="flex items-center gap-1 font-semibold text-xs">
                    <Globe className="w-3.5 h-3.5" />
                    <span>Public</span>
                  </div>
                  <p className="text-[10px] text-text-muted mt-0.5">Anyone can join instantly</p>
                </div>
              </label>

              <label
                className={`p-2.5 border rounded-brand flex items-start gap-2 cursor-pointer transition ${
                  type === 'private'
                    ? 'border-primary bg-teal-50/50 text-primary-dark'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value="private"
                  checked={type === 'private'}
                  onChange={() => setType('private')}
                  className="mt-0.5"
                />
                <div>
                  <div className="flex items-center gap-1 font-semibold text-xs">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Private</span>
                  </div>
                  <p className="text-[10px] text-text-muted mt-0.5">Join via approval or code</p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-brand text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-primary hover:bg-primary-dark text-white rounded-brand text-xs font-semibold disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Community'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateCommunityModal;
