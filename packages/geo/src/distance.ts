export type Coordinate = { latitude: number; longitude: number }

const EARTH_RADIUS_M = 6_371_008.8

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

/**
 * Great-circle distance by the haversine formula.
 *
 * A spherical earth is wrong by about 0.3% at worst, which at the distances this
 * application deals with — metres to a few kilometres — is well under a metre.
 * The GPS accuracy this is compared against is rarely better than 3 m, so a
 * more elaborate ellipsoidal calculation would be precision the input does not
 * have.
 */
export function distanceMetres(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}
