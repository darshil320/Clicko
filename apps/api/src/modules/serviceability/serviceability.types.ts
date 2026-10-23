/** Public shapes other modules may use (dispatch reads these through ServiceabilityService). */

/** Area + city names for a pincode: what a photographer offer shows instead of the address. */
export interface AreaLabel {
  readonly areaName: string | null;
  readonly cityName: string;
}

/** A pincode centroid and its city's centre as raw geography text (hex EWKB). */
export interface VenuePoints {
  readonly centroid: string | null;
  readonly cityCentre: string;
}
