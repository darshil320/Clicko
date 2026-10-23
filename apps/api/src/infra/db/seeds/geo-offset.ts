/** Seed/test helper: a point `northKm`/`eastKm` from a centre (equirectangular — fine under 50 km). */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

const KM_PER_DEGREE_LAT = 111.32;

export function offsetLatLng(centre: LatLng, northKm: number, eastKm: number): LatLng {
  const lat = centre.lat + northKm / KM_PER_DEGREE_LAT;
  const lng = centre.lng + eastKm / (KM_PER_DEGREE_LAT * Math.cos((centre.lat * Math.PI) / 180));
  return { lat, lng };
}

/** A point `distanceKm` away on a compass bearing (degrees clockwise from north). */
export function pointAt(centre: LatLng, distanceKm: number, bearingDeg: number): LatLng {
  const rad = (bearingDeg * Math.PI) / 180;
  return offsetLatLng(centre, distanceKm * Math.cos(rad), distanceKm * Math.sin(rad));
}
