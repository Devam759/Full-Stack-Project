import React, { useState, useEffect } from 'react';
import { MapPin, Search, Users, Plus, Globe, Lock, ArrowRight, Compass } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { CreateCommunityModal } from './CreateCommunityModal.jsx';

export function CommunitiesScreen({ onSelectCommunity }) {
  const { user } = useAuth();
  const [location, setLocation] = useState({ lat: 12.97, lng: 77.59, city: 'Bengaluru' });
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingCity, setIsSearchingCity] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchNearby = async (lat, lng) => {
    setLoading(true);
    try {
      const data = await apiRequest(`/communities/nearby?lat=${lat}&lng=${lng}&radius=25000`);
      setCommunities(data.communities || []);
    } catch {
      setCommunities([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNearby(location.lat, location.lng);
  }, [location.lat, location.lng]);

  const handleUseCurrentLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = Math.round(position.coords.latitude * 100) / 100;
          const lng = Math.round(position.coords.longitude * 100) / 100;

          // Reverse geocode to find city
          try {
            const revData = await apiRequest(`/locations/reverse?lat=${lat}&lng=${lng}`);
            setLocation({ lat, lng, city: revData.city || 'Nearby Area' });
          } catch {
            setLocation({ lat, lng, city: 'Current Location' });
          }
        },
        () => {
          alert('Location permission was denied. Please search for your city or area below.');
        },
      );
    }
  };

  const handleCitySearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearchingCity(true);

    try {
      const data = await apiRequest(
        `/locations/search?q=${encodeURIComponent(searchQuery.trim())}`,
      );
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearchingCity(false);
    }
  };

  const handleSelectCityResult = (res) => {
    setLocation({ lat: res.lat, lng: res.lng, city: res.city });
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-4 pb-24">
      {/* Header with Location & Create Button */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-lg font-heading font-bold text-slate-900">Communities</h1>
          <div className="flex items-center gap-1 text-xs text-text-muted mt-0.5">
            <MapPin className="w-3.5 h-3.5 text-primary" />
            <span className="font-medium text-slate-700">{location.city}</span>
          </div>
        </div>

        {user && (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="py-1.5 px-3 bg-primary hover:bg-primary-dark text-white text-xs font-semibold rounded-brand flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create</span>
          </button>
        )}
      </div>

      {/* Location / Search Selector */}
      <div className="bg-surface rounded-brand border border-slate-200 p-3 shadow-xs space-y-2">
        <form onSubmit={handleCitySearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search city or neighborhood..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs pl-8 pr-2 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
            />
          </div>
          <button
            type="submit"
            disabled={isSearchingCity}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-brand"
          >
            Search
          </button>
        </form>

        {/* Search Results Dropdown */}
        {searchResults.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-brand shadow-md divide-y divide-slate-100 max-h-48 overflow-y-auto">
            {searchResults.map((res, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelectCityResult(res)}
                className="w-full text-left p-2 hover:bg-slate-50 text-xs text-slate-700 flex items-start gap-2"
              >
                <Compass className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <span className="truncate">{res.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            className="text-[11px] text-primary hover:underline font-medium flex items-center gap-1"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Use current location</span>
          </button>

          <span className="text-[10px] text-text-muted">OpenStreetMap Geocoding</span>
        </div>
      </div>

      {/* Communities List */}
      <div className="space-y-3">
        {loading ? (
          <div className="p-8 text-center text-xs text-text-muted">
            Finding nearby communities...
          </div>
        ) : communities.length === 0 ? (
          /* Empty State (User Change 12) */
          <div className="bg-surface rounded-brand border border-slate-200 p-8 text-center space-y-3 shadow-xs">
            <div className="inline-flex p-3 rounded-full bg-slate-100 text-slate-400">
              <Users className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">No Communities Nearby Yet</h2>
              <p className="text-xs text-text-muted mt-1 max-w-xs mx-auto">
                Be the first to start a borrowing loop in {location.city}! Invite your hostel,
                campus, or apartment neighbors.
              </p>
            </div>
            {user ? (
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="mt-2 py-2 px-4 bg-primary hover:bg-primary-dark text-white text-xs font-semibold rounded-brand inline-flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Create a Community</span>
              </button>
            ) : (
              <p className="text-[11px] text-primary font-medium">Log in to create a community</p>
            )}
          </div>
        ) : (
          communities.map((comm) => (
            <div
              key={comm.id}
              onClick={() => onSelectCommunity(comm.id)}
              className="bg-surface rounded-brand border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition cursor-pointer space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 leading-snug">{comm.name}</h2>
                  <p className="text-xs text-text-muted mt-0.5">{comm.city}</p>
                </div>

                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 shrink-0 ${
                    comm.type === 'public'
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'bg-purple-50 text-purple-700 border border-purple-200'
                  }`}
                >
                  {comm.type === 'public' ? (
                    <Globe className="w-3 h-3" />
                  ) : (
                    <Lock className="w-3 h-3" />
                  )}
                  <span className="capitalize">{comm.type}</span>
                </span>
              </div>

              {comm.description && (
                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                  {comm.description}
                </p>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                <div className="flex items-center gap-3 text-text-muted">
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-medium text-slate-800">{comm.memberCount}</span>
                  </span>
                  <span>•</span>
                  <span>{comm.distanceBand}</span>
                </div>

                <div className="flex items-center gap-1 text-primary text-[11px] font-semibold">
                  <span>{comm.membershipStatus === 'active' ? 'Joined' : 'View'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateCommunityModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={(newComm) => {
            fetchNearby(location.lat, location.lng);
            onSelectCommunity(newComm._id);
          }}
          initialLocation={[location.lng, location.lat]}
          initialCity={location.city}
        />
      )}
    </div>
  );
}

export default CommunitiesScreen;
