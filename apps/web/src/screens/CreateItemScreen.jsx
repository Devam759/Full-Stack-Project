import React, { useState, useEffect } from 'react';
import { ArrowLeft, Upload, Trash2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { toPaise, BUSINESS_CONFIG } from '@borrowloop/shared';

const CATEGORIES = [
  { value: 'books_and_study', label: 'Books & Study Material' },
  { value: 'electronics_and_gadgets', label: 'Electronics & Tech Gadgets' },
  { value: 'home_and_kitchen', label: 'Home & Kitchen Appliances' },
  { value: 'tools_and_diy', label: 'Tools & DIY Equipment' },
  { value: 'sports_and_fitness', label: 'Sports & Fitness Gear' },
  { value: 'outdoor_and_camping', label: 'Outdoor & Camping Equipment' },
  { value: 'board_games_and_hobbies', label: 'Board Games & Hobbies' },
  { value: 'party_and_events', label: 'Party, Audio & Event Supplies' },
  { value: 'clothing_and_costumes', label: 'Clothing & Costumes' },
  { value: 'musical_instruments', label: 'Musical Instruments' },
  { value: 'other', label: 'Other Useful Everyday Items' },
];

const CONDITIONS = [
  { value: 'new', label: 'Brand New (Unused / in box)' },
  { value: 'like_new', label: 'Like New (Flawless condition)' },
  { value: 'good', label: 'Good (Minor wear, fully functional)' },
  { value: 'fair', label: 'Fair (Visible wear, works normally)' },
];

export function CreateItemScreen({ onBack, onSuccess }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('tools_and_diy');
  const [condition, setCondition] = useState('good');
  const [photos, setPhotos] = useState([]);
  const [rentRupees, setRentRupees] = useState('150');
  const [depositRupees, setDepositRupees] = useState('1000');
  const [lateFeeRupees, setLateFeeRupees] = useState('50');
  const [minDays, setMinDays] = useState(1);
  const [maxDays, setMaxDays] = useState(7);
  const [selectedCommunities, setSelectedCommunities] = useState([]);
  const [availableCommunities, setAvailableCommunities] = useState([]);
  const [electronicsWarningAccepted, setElectronicsWarningAccepted] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isDataSensitive = BUSINESS_CONFIG.DATA_SENSITIVE_CATEGORIES.includes(category);

  // Fetch communities where user is a member
  useEffect(() => {
    async function loadCommunities() {
      try {
        const token = localStorage.getItem('accessToken');
        const res = await fetch('/v1/communities/nearby?radius=50', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          // Filter to communities where user is a member
          const joined = (data.communities || []).filter((c) => c.membershipStatus === 'active');
          setAvailableCommunities(joined);
          if (joined.length > 0) {
            setSelectedCommunities([joined[0]._id]);
          }
        }
      } catch {
        // Fallback
      }
    }
    loadCommunities();
  }, []);

  // Photo Upload Handler via Cloudinary signed upload
  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    if (photos.length + files.length > BUSINESS_CONFIG.MAX_ITEM_PHOTOS) {
      setError(`You can only upload up to ${BUSINESS_CONFIG.MAX_ITEM_PHOTOS} photos`);
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const token = localStorage.getItem('accessToken');
      for (const file of files) {
        // 1. Get signed signature
        const signRes = await fetch('/v1/uploads/sign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ type: 'item' }),
        });

        if (!signRes.ok) {
          throw new Error('Failed to obtain signed upload authorization');
        }

        const signData = await signRes.json();

        // 2. Upload directly to Cloudinary
        const formData = new FormData();
        formData.append('file', file);
        formData.append('api_key', signData.apiKey);
        formData.append('timestamp', signData.timestamp);
        formData.append('signature', signData.signature);
        formData.append('folder', signData.folder);
        formData.append('image_metadata', 'false');
        formData.append('tags', signData.tags);

        const uploadRes = await fetch(signData.uploadUrl, {
          method: 'POST',
          body: formData,
        });

        if (!uploadRes.ok) {
          throw new Error('Image upload failed');
        }

        const uploadResult = await uploadRes.json();
        setPhotos((prev) => [...prev, uploadResult.secure_url]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (idx) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleCommunity = (id) => {
    setSelectedCommunities((prev) =>
      prev.includes(id) ? prev.filter((cId) => cId !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (photos.length === 0) {
      setError('Please upload at least one photo of the item');
      return;
    }

    if (selectedCommunities.length === 0) {
      setError('Please select at least one community for this listing');
      return;
    }

    if (isDataSensitive && !electronicsWarningAccepted) {
      setError('You must acknowledge the electronics data-reset warning before proceeding');
      return;
    }

    let rentPaise;
    let depositPaise;
    let lateFeePaise;
    try {
      rentPaise = toPaise(rentRupees);
      depositPaise = toPaise(depositRupees);
      lateFeePaise = lateFeeRupees ? toPaise(lateFeeRupees) : 0;
    } catch {
      setError('Please enter valid numeric amounts for rent and deposit');
      return;
    }

    const payload = {
      title,
      description,
      category,
      condition,
      photos,
      rentPerDayPaise: rentPaise,
      depositPaise: depositPaise,
      lateFeePerDayPaise: lateFeePaise,
      minDays: Number(minDays),
      maxDays: Number(maxDays),
      communityIds: selectedCommunities,
      electronicsWarningAccepted: isDataSensitive ? electronicsWarningAccepted : undefined,
    };

    setSubmitting(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/v1/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to list item');
      }

      onSuccess(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 pb-24 space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to items</span>
      </button>

      <div>
        <h1 className="text-xl font-heading font-bold text-slate-900">List an Item</h1>
        <p className="text-xs text-text-muted mt-0.5">
          Share your items with neighbors and earn demo rent
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Item Title *</label>
          <input
            type="text"
            required
            minLength={3}
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Bosch 18V Cordless Hammer Drill"
            className="w-full px-3 py-2 bg-surface border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-xs"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Category *</label>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setElectronicsWarningAccepted(false);
            }}
            className="w-full px-3 py-2 bg-surface border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-xs"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Data Sensitive Category Warning (Rule 6) */}
        {isDataSensitive && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="font-semibold">Electronic Device Data Advisory</div>
            </div>
            <p className="text-[11px] leading-relaxed">
              Before lending electronics that store personal files or accounts, make sure all
              private data is cleared and factory reset.
            </p>
            <label className="flex items-start gap-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={electronicsWarningAccepted}
                onChange={(e) => setElectronicsWarningAccepted(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span className="text-[11px] font-medium text-amber-950">
                I understand and agree to wipe all private accounts and files prior to handover.
              </span>
            </label>
          </div>
        )}

        {/* Condition */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Condition *</label>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-xs"
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Photos (Cloudinary upload) */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Photos (1 to {BUSINESS_CONFIG.MAX_ITEM_PHOTOS}) *
          </label>

          <div className="grid grid-cols-3 gap-2 mb-2">
            {photos.map((url, idx) => (
              <div
                key={url}
                className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 group"
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(idx)}
                  className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full opacity-80 hover:opacity-100 transition shadow-xs"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}

            {photos.length < BUSINESS_CONFIG.MAX_ITEM_PHOTOS && (
              <label className="aspect-square rounded-lg border-2 border-dashed border-slate-300 hover:border-primary transition flex flex-col items-center justify-center cursor-pointer text-slate-400 hover:text-primary bg-slate-50">
                <Upload className="w-5 h-5 mb-1" />
                <span className="text-[10px] font-medium">Add Photo</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={handlePhotoUpload}
                  className="hidden"
                  disabled={uploading}
                />
              </label>
            )}
          </div>
          {uploading && (
            <p className="text-xs text-primary animate-pulse">Uploading photos to storage...</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Description *</label>
          <textarea
            required
            rows={3}
            minLength={10}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what's included, rules for care, and any pickup requirements."
            className="w-full px-3 py-2 bg-surface border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-xs"
          />
        </div>

        {/* Pricing Card - Demo Money */}
        <div className="p-3.5 bg-surface border border-slate-200 rounded-xl space-y-3 shadow-xs">
          <div className="flex items-center justify-between pb-1 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-800">Pricing & Security Deposit</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-300">
              Demo money
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Daily Rent (₹) *
              </label>
              <input
                type="number"
                min="0"
                max="10000"
                required
                value={rentRupees}
                onChange={(e) => setRentRupees(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-background border border-slate-200 rounded text-sm font-semibold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Security Deposit (₹) *
              </label>
              <input
                type="number"
                min="0"
                max="50000"
                required
                value={depositRupees}
                onChange={(e) => setDepositRupees(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-background border border-slate-200 rounded text-sm font-semibold"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">
              Late Fee per Day (₹, optional)
            </label>
            <input
              type="number"
              min="0"
              max="10000"
              value={lateFeeRupees}
              onChange={(e) => setLateFeeRupees(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-background border border-slate-200 rounded text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Min Days (1-30)
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={minDays}
                onChange={(e) => setMinDays(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-background border border-slate-200 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Max Days (1-30)
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={maxDays}
                onChange={(e) => setMaxDays(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-background border border-slate-200 rounded text-xs"
              />
            </div>
          </div>
        </div>

        {/* Community Visibility Selection (Rule 1) */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Select Communities to Share With *
          </label>
          {availableCommunities.length === 0 ? (
            <p className="text-xs text-text-muted bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              You haven&apos;t joined any communities yet. Join a community first before listing
              items!
            </p>
          ) : (
            <div className="space-y-1.5">
              {availableCommunities.map((c) => (
                <label
                  key={c._id}
                  className="flex items-center gap-2.5 p-2 bg-surface border border-slate-200 rounded-lg text-xs cursor-pointer hover:bg-slate-50 transition"
                >
                  <input
                    type="checkbox"
                    checked={selectedCommunities.includes(c._id)}
                    onChange={() => toggleCommunity(c._id)}
                    className="accent-primary"
                  />
                  <div className="flex-1">
                    <span className="font-semibold text-slate-800">{c.name}</span>
                    <span className="text-[11px] text-text-muted ml-1.5">({c.city})</span>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || uploading || availableCommunities.length === 0}
          className="w-full py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition shadow-md disabled:opacity-50 mt-4"
        >
          {submitting ? 'Listing Item...' : 'Publish Item Listing'}
        </button>
      </form>
    </div>
  );
}

export default CreateItemScreen;
