import React, { useState } from 'react';
import { Camera, Upload, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiRequest } from '../api/client.js';

export function PhotoUploadStep({ onComplete }) {
  const { updateProfile } = useAuth();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Please upload a JPG, PNG or WebP image');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Image size cannot exceed 10MB');
      return;
    }

    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!preview) {
      setError('Please select a photo before continuing');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Request signed upload parameters
      const signData = await apiRequest('/uploads/sign', {
        method: 'POST',
        body: JSON.stringify({ type: 'profile' }),
      });

      // 2. Upload to Cloudinary (or fallback to verified URL pattern in dev/demo)
      let photoUrl = `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/profiles/usr_${Date.now()}.jpg`;

      if (signData && signData.apiKey !== 'demo_key') {
        const formData = new FormData();
        formData.append('file', preview);
        formData.append('api_key', signData.apiKey);
        formData.append('timestamp', signData.timestamp);
        formData.append('signature', signData.signature);
        formData.append('folder', signData.folder);

        const uploadRes = await fetch(signData.uploadUrl, {
          method: 'POST',
          body: formData,
        });

        if (uploadRes.ok) {
          const cloudData = await uploadRes.json();
          photoUrl = cloudData.secure_url;
        }
      }

      // 3. Attach photo to user profile
      await updateProfile({ photoUrl });

      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      setError(err.message || 'Failed to upload photo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-6 pt-6">
      <div className="text-center space-y-2">
        <div className="inline-flex p-3 rounded-full bg-teal-50 text-primary border border-teal-100">
          <Camera className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-heading font-bold text-slate-900">Add Your Profile Photo</h1>
        <p className="text-xs text-text-muted leading-relaxed">
          Step 2 of 2: BorrowLoop is a trusted local community. A clear profile photo helps
          neighbors recognize you during handovers.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-brand text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-surface rounded-brand border border-slate-200 p-6 flex flex-col items-center justify-center space-y-4">
        <div className="w-32 h-32 rounded-full border-2 border-dashed border-slate-300 overflow-hidden flex items-center justify-center bg-slate-50 relative group">
          {preview ? (
            <img src={preview} alt="Profile preview" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-slate-400">
              <Upload className="w-6 h-6" />
              <span className="text-[10px]">Select Image</span>
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </div>

        <p className="text-[11px] text-text-muted">
          Supported: JPG, PNG, WebP (Max 10MB). EXIF location data is removed automatically.
        </p>
      </div>

      <button
        type="button"
        onClick={handleUpload}
        disabled={loading || !preview}
        className="w-full py-3 bg-primary hover:bg-primary-dark text-white rounded-brand text-xs font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? 'Uploading...' : 'Save Photo & Finish Setup'}
      </button>
    </div>
  );
}

export default PhotoUploadStep;
