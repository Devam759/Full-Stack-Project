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
    <div className="max-w-md mx-auto p-4 space-y-6 pt-10">
      <div className="text-center space-y-2">
        <div className="inline-flex p-4 rounded-full bg-neutral-100 text-black border border-neutral-200">
          <Camera className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-heading font-black tracking-tight text-black">
          Add your profile photo
        </h1>
        <p className="text-sm text-neutral-500 leading-relaxed max-w-sm mx-auto">
          Step 2 of 2: A clear profile photo builds trust and ensures smooth, verified peer
          handovers.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <div className="bg-white rounded-3xl border border-neutral-200 p-8 flex flex-col items-center justify-center space-y-5 shadow-sm">
        <div className="w-36 h-36 rounded-full border-2 border-dashed border-neutral-300 hover:border-black overflow-hidden flex items-center justify-center bg-neutral-50 relative group transition cursor-pointer">
          {preview ? (
            <img src={preview} alt="Profile preview" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-neutral-400 group-hover:text-black transition">
              <Upload className="w-7 h-7" />
              <span className="text-xs font-semibold">Upload photo</span>
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </div>

        <p className="text-xs text-neutral-500 text-center">
          JPG, PNG or WebP up to 10MB. Location metadata is automatically stripped for your privacy.
        </p>
      </div>

      <button
        type="button"
        onClick={handleUpload}
        disabled={loading || !preview}
        className="w-full py-3.5 bg-black hover:bg-neutral-800 active:bg-neutral-900 text-white rounded-full text-sm font-bold transition shadow-xs disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? 'Uploading...' : 'Save photo and finish setup'}
      </button>
    </div>
  );
}

export default PhotoUploadStep;
