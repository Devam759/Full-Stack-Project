import React, { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Filter, MapPin, Tag } from 'lucide-react';
import { formatPaise, BUSINESS_CONFIG } from '@borrowloop/shared';

const CATEGORIES = [
  { id: '', label: 'All Items' },
  { id: 'books_and_study', label: 'Books & Study' },
  { id: 'electronics_and_gadgets', label: 'Electronics & Tech' },
  { id: 'home_and_kitchen', label: 'Home & Kitchen' },
  { id: 'tools_and_diy', label: 'Tools & DIY' },
  { id: 'sports_and_fitness', label: 'Sports & Fitness' },
  { id: 'outdoor_and_camping', label: 'Outdoor & Camping' },
  { id: 'board_games_and_hobbies', label: 'Board Games' },
  { id: 'party_and_events', label: 'Party & Events' },
  { id: 'clothing_and_costumes', label: 'Clothing' },
  { id: 'musical_instruments', label: 'Music & Instruments' },
  { id: 'other', label: 'Other' },
];

export function ItemsBrowseScreen({ onSelectItem, onCreateItem }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [radiusKm, setRadiusKm] = useState(10);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [userCoords, setUserCoords] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  // Detect user geolocation if allowed
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserCoords({
            lat: Number(pos.coords.latitude.toFixed(2)),
            lng: Number(pos.coords.longitude.toFixed(2)),
          });
        },
        () => {
          // Ignored if user declined permission
        },
      );
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams();
      if (searchTerm.trim()) queryParams.set('q', searchTerm.trim());
      if (selectedCategory) queryParams.set('category', selectedCategory);
      if (userCoords) {
        queryParams.set('lat', userCoords.lat);
        queryParams.set('lng', userCoords.lng);
        queryParams.set('radius', radiusKm);
      }
      if (fromDate && toDate) {
        queryParams.set('from', fromDate);
        queryParams.set('to', toDate);
      }

      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/v1/items?${queryParams.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || 'Failed to load items');
      }

      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, selectedCategory, radiusKm, fromDate, toDate, userCoords]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  return (
    <div className="p-4 pb-24 space-y-4">
      {/* Header & List Item CTA */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-heading font-bold text-slate-900">Borrow Items</h1>
          <p className="text-xs text-text-muted">Everyday items from your communities</p>
        </div>
        <button
          type="button"
          onClick={onCreateItem}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-dark transition shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>List Item</span>
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search tools, games, cameras..."
          className="w-full pl-9 pr-10 py-2 bg-surface border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-xs"
        />
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={`absolute right-2 top-2 p-1 rounded hover:bg-slate-100 ${
            showFilters ? 'text-primary' : 'text-slate-400'
          }`}
          aria-label="Toggle Filters"
        >
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {/* Expandable Advanced Filters */}
      {showFilters && (
        <div className="p-3 bg-surface border border-slate-200 rounded-xl space-y-3 shadow-xs text-xs">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="font-medium text-slate-700">Distance Radius</span>
              <span className="text-primary font-semibold">{radiusKm} km</span>
            </div>
            <input
              type="range"
              min="1"
              max={BUSINESS_CONFIG.MAX_SEARCH_RADIUS_KM}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-700 font-medium mb-1">Available From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full p-1.5 bg-background border border-slate-200 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-medium mb-1">Available To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full p-1.5 bg-background border border-slate-200 rounded text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Horizontal Category Chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setSelectedCategory(cat.id)}
            className={`whitespace-nowrap px-3 py-1 rounded-full font-medium transition ${
              selectedCategory === cat.id
                ? 'bg-primary text-white shadow-xs'
                : 'bg-surface border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-12 text-center text-text-muted text-xs">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Loading items...
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && items.length === 0 && (
        <div className="py-12 text-center bg-surface border border-dashed border-slate-200 rounded-xl p-6">
          <Tag className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <h3 className="font-heading font-semibold text-slate-800 text-sm">No items found</h3>
          <p className="text-xs text-text-muted mt-1 max-w-xs mx-auto">
            {searchTerm || selectedCategory
              ? 'Try adjusting your search terms or filters.'
              : 'Be the first in your community to list an item for others to borrow!'}
          </p>
          <button
            type="button"
            onClick={onCreateItem}
            className="mt-4 inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-dark transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>List an Item</span>
          </button>
        </div>
      )}

      {/* Items Cards Grid */}
      {!loading && !error && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((item) => {
            const cardImg =
              item.photoVariants?.[0]?.card ||
              item.photos?.[0] ||
              'https://placehold.co/600x400?text=No+Photo';

            return (
              <div
                key={item._id}
                onClick={() => onSelectItem(item._id)}
                className="bg-surface border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition cursor-pointer flex flex-col group"
              >
                {/* Photo Preview */}
                <div className="relative aspect-4/3 bg-slate-100 overflow-hidden">
                  <img
                    src={cardImg}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    loading="lazy"
                  />
                  <div className="absolute top-2 left-2 flex gap-1">
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-black/60 text-white backdrop-blur-xs uppercase tracking-wider">
                      {item.condition.replace('_', ' ')}
                    </span>
                  </div>
                  {item.distanceBand && (
                    <div className="absolute bottom-2 left-2 bg-surface/90 backdrop-blur-xs px-2 py-0.5 rounded text-[11px] font-medium text-slate-700 flex items-center gap-1 shadow-xs">
                      <MapPin className="w-3 h-3 text-primary" />
                      <span>{item.distanceBand}</span>
                    </div>
                  )}
                </div>

                {/* Card Content */}
                <div className="p-3 flex-1 flex flex-col justify-between">
                  <div>
                    <h2 className="font-heading font-semibold text-slate-900 text-sm line-clamp-1">
                      {item.title}
                    </h2>
                    <p className="text-xs text-text-muted line-clamp-2 mt-0.5">
                      {item.description}
                    </p>
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-sm font-bold text-primary font-heading">
                          {formatPaise(item.rentPerDayPaise)}
                        </span>
                        <span className="text-[11px] text-text-muted">/ day</span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Deposit: {formatPaise(item.depositPaise)}
                      </div>
                    </div>

                    {/* Demo Money Tag - Hard Rule 9 */}
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                      Demo money
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ItemsBrowseScreen;
