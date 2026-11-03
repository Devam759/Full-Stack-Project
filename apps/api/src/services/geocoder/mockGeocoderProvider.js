import GeocoderProvider from './geocoderProvider.js';

export class MockGeocoderProvider extends GeocoderProvider {
  async search(query) {
    if (!query) return [];
    return [
      {
        label: `${query}, Karnataka, India`,
        lat: 12.97,
        lng: 77.59,
        city: 'Bengaluru',
      },
      {
        label: `${query}, Maharashtra, India`,
        lat: 19.07,
        lng: 72.87,
        city: 'Mumbai',
      },
    ];
  }

  async reverse(lat, lng) {
    return {
      city: 'Bengaluru',
      label: `Approximate Location near ${lat}, ${lng}`,
    };
  }
}

export default MockGeocoderProvider;
