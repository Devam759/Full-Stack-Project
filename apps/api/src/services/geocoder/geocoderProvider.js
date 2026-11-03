/**
 * Base GeocoderProvider interface.
 */
export class GeocoderProvider {
  /**
   * Searches for matching locations by query text.
   * @param {string} _query
   * @returns {Promise<Array<{ label: string, lat: number, lng: number, city: string }>>}
   */
  async search(_query) {
    throw new Error('Not implemented');
  }

  /**
   * Reverse geocodes coordinates to a city/area.
   * @param {number} _lat
   * @param {number} _lng
   * @returns {Promise<{ city: string, label: string }>}
   */
  async reverse(_lat, _lng) {
    throw new Error('Not implemented');
  }
}

export default GeocoderProvider;
