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
    <div className="space-y-8 pb-20">
      {/* Header with Title and Create CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-heading font-black tracking-tight text-black">
            Communities
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Discover verified campus circles and neighborhood sharing hubs near you.
          </p>
        </div>

        {user && (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="self-start sm:self-auto py-2.5 px-5 bg-black hover:bg-neutral-800 text-white text-xs font-bold rounded-full inline-flex items-center gap-2 shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>Create community</span>
          </button>
        )}
      </div>

      {/* Location / Search Box (Uber styled search bar) */}
      <div className="bg-neutral-50 border border-neutral-200 rounded-3xl p-5 sm:p-6 space-y-3">
        <form onSubmit={handleCitySearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-neutral-400 absolute left-4 top-3.5" />
            <input
              type="text"
              placeholder="Search city, campus, or neighborhood..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-sm pl-11 pr-4 py-3 bg-white border border-neutral-200 focus:border-black rounded-xl outline-none transition"
            />
          </div>
          <button
            type="submit"
            disabled={isSearchingCity}
            className="px-6 py-3 bg-black hover:bg-neutral-800 text-white text-xs font-bold rounded-xl transition disabled:opacity-50"
          >
            Search
          </button>
        </form>

        {/* Search Results Dropdown */}
        {searchResults.length > 0 && (
          <div className="bg-white border border-neutral-200 rounded-2xl shadow-lg divide-y divide-neutral-100 max-h-56 overflow-y-auto">
            {searchResults.map((res, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelectCityResult(res)}
                className="w-full text-left p-3 hover:bg-neutral-50 text-sm text-neutral-800 flex items-start gap-2.5 transition"
              >
                <Compass className="w-4 h-4 text-black mt-0.5 shrink-0" />
                <span className="truncate">{res.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-500">Current area:</span>
            <span className="inline-flex items-center gap-1 font-bold text-black bg-white px-3 py-1 rounded-full border border-neutral-200">
              <MapPin className="w-3.5 h-3.5 text-black" />
              <span>{location.city}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={handleUseCurrentLocation}
            className="text-xs text-black hover:underline font-bold inline-flex items-center gap-1.5 transition"
          >
            <Compass className="w-4 h-4" />
            <span>Use my GPS location</span>
          </button>
        </div>
      </div>

      {/* Communities Grid */}
      <div>
        {loading ? (
          <div className="py-20 text-center text-sm text-neutral-400 font-medium">
            Finding nearby communities...
          </div>
        ) : communities.length === 0 ? (
          /* Empty State */
          <div className="bg-white rounded-3xl border border-neutral-200 p-12 text-center space-y-4 shadow-sm max-w-xl mx-auto">
            <div className="inline-flex p-4 rounded-full bg-neutral-100 text-neutral-500">
              <Users className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-black">No communities nearby yet</h2>
              <p className="text-sm text-neutral-500 mt-1 max-w-md mx-auto">
                Be the first to start a borrowing loop in {location.city}! Invite your hostel mates,
                campus peers, or neighbors.
              </p>
            </div>
            {user ? (
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="mt-3 py-3 px-6 bg-black hover:bg-neutral-800 text-white text-xs font-bold rounded-full inline-flex items-center gap-2 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create a community</span>
              </button>
            ) : (
              <p className="text-xs text-black font-bold">Log in to create a community</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {communities.map((comm) => (
              <div
                key={comm.id}
                onClick={() => onSelectCommunity(comm.id)}
                className="bg-white rounded-2xl border border-neutral-200 hover:border-black p-6 shadow-xs hover:shadow-md transition cursor-pointer flex flex-col justify-between group"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-black group-hover:text-neutral-900 transition leading-snug">
                        {comm.name}
                      </h2>
                      <p className="text-xs text-neutral-500 mt-0.5">{comm.city}</p>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 shrink-0 ${
                        comm.type === 'public'
                          ? 'bg-neutral-100 text-neutral-900'
                          : 'bg-neutral-900 text-white'
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
                    <p className="text-xs text-neutral-600 line-clamp-2 leading-relaxed">
                      {comm.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-4 mt-4 border-t border-neutral-100 text-xs">
                  <div className="flex items-center gap-3 text-neutral-500">
                    <span className="flex items-center gap-1 font-semibold text-black">
                      <Users className="w-3.5 h-3.5 text-neutral-400" />
                      <span>{comm.memberCount} members</span>
                    </span>
                    <span>•</span>
                    <span>{comm.distanceBand}</span>
                  </div>

                  <div className="flex items-center gap-1 text-black font-bold group-hover:translate-x-0.5 transition-transform">
                    <span>{comm.membershipStatus === 'active' ? 'Joined' : 'Explore'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
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
