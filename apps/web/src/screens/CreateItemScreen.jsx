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
    <div className="max-w-2xl mx-auto space-y-6 pb-20">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-xs font-bold text-neutral-600 hover:text-black transition"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to items</span>
      </button>

      <div>
        <h1 className="text-3xl font-heading font-black tracking-tight text-black">List an item</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Share high-utility items with neighbors and earn demo rental income.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-center gap-2.5">
          <ShieldAlert className="w-4 h-4 shrink-0 text-red-600" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div>
          <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
            Item title *
          </label>
          <input
            type="text"
            required
            minLength={3}
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Sony Alpha A7 III Camera Body"
            className="w-full px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-sm transition outline-none"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
            Category *
          </label>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setElectronicsWarningAccepted(false);
            }}
            className="w-full px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-sm transition outline-none cursor-pointer"
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
          <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-2xl text-xs text-neutral-900 space-y-2.5">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-black shrink-0 mt-0.5" />
              <div className="font-bold text-black">Electronic device data advisory</div>
            </div>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Before lending electronics that store personal files or accounts, make sure all
              private data is cleared and factory reset.
            </p>
            <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={electronicsWarningAccepted}
                onChange={(e) => setElectronicsWarningAccepted(e.target.checked)}
                className="mt-0.5 accent-black"
              />
              <span className="text-xs font-semibold text-black">
                I understand and agree to wipe all private accounts and files prior to handover.
              </span>
            </label>
          </div>
        )}

        {/* Condition */}
        <div>
          <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
            Condition *
          </label>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className="w-full px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-sm transition outline-none cursor-pointer"
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
          <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-2">
            Photos (1 to {BUSINESS_CONFIG.MAX_ITEM_PHOTOS}) *
          </label>

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-2">
            {photos.map((url, idx) => (
              <div
                key={url}
                className="relative aspect-square rounded-2xl overflow-hidden border border-neutral-200 group"
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(idx)}
                  className="absolute top-1.5 right-1.5 p-1 bg-black/80 hover:bg-black text-white rounded-full transition shadow-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {photos.length < BUSINESS_CONFIG.MAX_ITEM_PHOTOS && (
              <label className="aspect-square rounded-2xl border-2 border-dashed border-neutral-300 hover:border-black transition flex flex-col items-center justify-center cursor-pointer text-neutral-400 hover:text-black bg-neutral-50 group">
                <Upload className="w-6 h-6 mb-1 text-neutral-400 group-hover:text-black transition" />
                <span className="text-xs font-semibold">Add Photo</span>
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
            <p className="text-xs text-neutral-600 font-semibold animate-pulse">
              Uploading photos...
            </p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
            Description *
          </label>
          <textarea
            required
            rows={4}
            minLength={10}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe features, accessories included, usage guidelines, and preferred handover spots."
            className="w-full px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-sm transition outline-none resize-none"
          />
        </div>

        {/* Pricing Card - Demo Money */}
        <div className="p-6 bg-white border border-neutral-200 rounded-3xl space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
            <span className="text-sm font-bold text-black">Pricing &amp; Security Deposit</span>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-400 text-black shadow-xs">
              Demo money
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1">
                Daily rent (₹) *
              </label>
              <input
                type="number"
                min="0"
                max="10000"
                required
                value={rentRupees}
                onChange={(e) => setRentRupees(e.target.value)}
                className="w-full px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-sm font-bold outline-none transition"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1">
                Security deposit (₹) *
              </label>
              <input
                type="number"
                min="0"
                max="50000"
                required
                value={depositRupees}
                onChange={(e) => setDepositRupees(e.target.value)}
                className="w-full px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-sm font-bold outline-none transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1">
              Late fee per day (₹, optional)
            </label>
            <input
              type="number"
              min="0"
              max="10000"
              value={lateFeeRupees}
              onChange={(e) => setLateFeeRupees(e.target.value)}
              className="w-full px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-sm outline-none transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1">
                Min days (1-30)
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={minDays}
                onChange={(e) => setMinDays(e.target.value)}
                className="w-full px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-sm outline-none transition"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1">
                Max days (1-30)
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={maxDays}
                onChange={(e) => setMaxDays(e.target.value)}
                className="w-full px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-sm outline-none transition"
              />
            </div>
          </div>
        </div>

        {/* Community Visibility Selection (Rule 1) */}
        <div>
          <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-2">
            Select communities to share with *
          </label>
          {availableCommunities.length === 0 ? (
            <p className="text-xs text-neutral-600 bg-neutral-50 p-4 rounded-2xl border border-neutral-200">
              You haven&apos;t joined any communities yet. Join a community first before listing
              items!
            </p>
          ) : (
            <div className="space-y-2">
              {availableCommunities.map((c) => (
                <label
                  key={c._id}
                  className="flex items-center gap-3 p-3.5 bg-white border border-neutral-200 rounded-2xl text-xs cursor-pointer hover:border-black transition"
                >
                  <input
                    type="checkbox"
                    checked={selectedCommunities.includes(c._id)}
                    onChange={() => toggleCommunity(c._id)}
                    className="accent-black w-4 h-4 rounded"
                  />
                  <div className="flex-1">
                    <span className="font-bold text-black text-sm">{c.name}</span>
                    <span className="text-xs text-neutral-500 ml-2">({c.city})</span>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || uploading || availableCommunities.length === 0}
          className="w-full py-4 bg-black hover:bg-neutral-800 active:bg-neutral-900 text-white text-sm font-bold rounded-full transition shadow-xs disabled:opacity-50 mt-4"
        >
          {submitting ? 'Listing item...' : 'Publish item listing'}
        </button>
      </form>
    </div>
  );
}

export default CreateItemScreen;
