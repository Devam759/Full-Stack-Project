import crypto from 'crypto';
import config from '../config/index.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const { UPLOAD_FOLDERS, ALLOWED_IMAGE_EXTENSIONS } = BUSINESS_CONFIG;

/**
 * Generates signed parameters for direct image upload to Cloudinary.
 * Enforces folder routing, allowed formats, and EXIF/metadata removal.
 *
 * @param {'profile' | 'item' | 'handover'} type
 * @param {string} userId
 * @returns {object} signed upload payload
 */
export function generateUploadSignature(type, userId) {
  const folder =
    type === 'profile'
      ? UPLOAD_FOLDERS.PROFILE
      : type === 'handover'
        ? UPLOAD_FOLDERS.HANDOVER
        : UPLOAD_FOLDERS.ITEM;

  const timestamp = Math.floor(Date.now() / 1000);

  // Parameters to sign in alphabetical order
  const paramsToSign = {
    folder,
    image_metadata: 'false',
    tags: `user_${userId},type_${type}`,
    timestamp: String(timestamp),
  };

  const serialized = Object.keys(paramsToSign)
    .sort()
    .map((key) => `${key}=${paramsToSign[key]}`)
    .join('&');

  const signature = crypto
    .createHash('sha1')
    .update(serialized + config.IMAGE_API_SECRET)
    .digest('hex');

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.IMAGE_CLOUD_NAME}/image/upload`,
    apiKey: config.IMAGE_API_KEY,
    timestamp,
    signature,
    folder,
    allowedFormats: ALLOWED_IMAGE_EXTENSIONS,
    maxSizeBytes: BUSINESS_CONFIG.MAX_UPLOAD_SIZE_BYTES,
    tags: paramsToSign.tags,
  };
}

/**
 * Validates that an image URL comes from our configured Cloudinary account,
 * targets the allowed folder, and carries an allowed extension.
 *
 * @param {string} url
 * @param {'profile' | 'item' | 'handover'} [expectedType='profile']
 * @returns {boolean}
 */
export function isValidCloudinaryPhotoUrl(url, expectedType = 'profile') {
  if (typeof url !== 'string' || !url.trim()) return false;

  const folder =
    expectedType === 'profile'
      ? UPLOAD_FOLDERS.PROFILE
      : expectedType === 'handover'
        ? UPLOAD_FOLDERS.HANDOVER
        : UPLOAD_FOLDERS.ITEM;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

    // Must be res.cloudinary.com
    if (parsed.hostname !== 'res.cloudinary.com') return false;

    // Path must contain our cloud name and designated folder
    const expectedPrefix = `/${config.IMAGE_CLOUD_NAME}/image/upload/`;
    if (!parsed.pathname.startsWith(expectedPrefix)) return false;

    if (!parsed.pathname.includes(folder)) return false;

    // Allowed extension check
    const extension = parsed.pathname.split('.').pop()?.toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.includes(extension)) return false;

    return true;
  } catch {
    return false;
  }
}
