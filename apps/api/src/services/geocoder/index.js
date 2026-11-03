import NominatimProvider from './nominatimProvider.js';
import MockGeocoderProvider from './mockGeocoderProvider.js';

let geocoderInstance = null;

export function getGeocoder() {
  if (!geocoderInstance) {
    const providerType =
      process.env.GEOCODER_PROVIDER || (process.env.NODE_ENV === 'test' ? 'mock' : 'nominatim');
    if (providerType === 'mock') {
      geocoderInstance = new MockGeocoderProvider();
    } else {
      geocoderInstance = new NominatimProvider();
    }
  }
  return geocoderInstance;
}

export default getGeocoder;
