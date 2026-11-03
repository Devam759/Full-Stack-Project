import GeocoderProvider from './geocoderProvider.js';
import { getRedisClient } from '../../redis.js';
import config from '../../config/index.js';
import logger from '../../common/logger.js';

export class NominatimProvider extends GeocoderProvider {
  constructor(baseUrl = config.GEOCODER_URL) {
    super();
    this.baseUrl = baseUrl || 'https://nominatim.openstreetmap.org';
  }

  async search(query) {
    if (!query || query.trim().length < 2) return [];

    const normalized = query.trim().toLowerCase();
    const cacheKey = `geo:search:${normalized}`;
    const redis = getRedisClient();

    if (redis && redis.status === 'ready') {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (err) {
        logger.warn({ err: err.message }, 'Redis cache read error in geocoder');
      }
    }

    try {
      const url = `${this.baseUrl}/search?format=json&q=${encodeURIComponent(normalized)}&addressdetails=1&limit=5`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'BorrowLoop-App/1.0 (contact@borrowloop.test)',
        },
      });

      if (!res.ok) return [];

      const data = await res.json();
      const results = data.map((item) => ({
        label: item.display_name,
        lat: Math.round(Number(item.lat) * 100) / 100, // Rounded to 2 decimals
        lng: Math.round(Number(item.lon) * 100) / 100,
        city:
          item.address?.city ||
          item.address?.town ||
          item.address?.state_district ||
          item.address?.state ||
          'Unknown',
      }));

      if (redis && redis.status === 'ready') {
        // Cache search results for 24 hours
        await redis.set(cacheKey, JSON.stringify(results), 'EX', 86400).catch(() => {});
      }

      return results;
    } catch (err) {
      logger.error({ err: err.message }, 'Nominatim geocoding failed');
      return [];
    }
  }

  async reverse(lat, lng) {
    const roundedLat = Math.round(lat * 100) / 100;
    const roundedLng = Math.round(lng * 100) / 100;
    const cacheKey = `geo:rev:${roundedLat}:${roundedLng}`;
    const redis = getRedisClient();

    if (redis && redis.status === 'ready') {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {
        // ignore
      }
    }

    try {
      const url = `${this.baseUrl}/reverse?format=json&lat=${roundedLat}&lon=${roundedLng}&addressdetails=1`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'BorrowLoop-App/1.0 (contact@borrowloop.test)',
        },
      });

      if (!res.ok) return { city: 'Unknown', label: 'Approximate Location' };

      const item = await res.json();
      const result = {
        city:
          item.address?.city ||
          item.address?.town ||
          item.address?.state_district ||
          item.address?.state ||
          'Unknown',
        label: item.display_name || 'Approximate Location',
      };

      if (redis && redis.status === 'ready') {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400).catch(() => {});
      }

      return result;
    } catch {
      return { city: 'Unknown', label: 'Approximate Location' };
    }
  }
}

export default NominatimProvider;
