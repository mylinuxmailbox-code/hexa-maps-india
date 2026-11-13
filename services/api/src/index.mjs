/**
 * HEXA MAPS — Provider Registry & Privacy-Preserving Logger
 *
 * Enforces Architectural Rules:
 * 1. All external/geospatial engines sit behind replaceable provider interfaces
 *    (`TileProvider`, `GeocodingProvider`, `RoutingProvider`, `TrafficProvider`,
 *     `TransitProvider`, `WeatherProvider`, `AirQualityProvider`, `ImageStorageProvider`,
 *     `AIProvider`, `IdentityProvider`).
 * 2. Zero raw GPS coordinates (`lat`, `lon`, `latitude`, `longitude`, `coordinates`,
 *    `trace`, `bbox`) ever appear in ordinary application logs.
 */

const SENSITIVE_COORD_KEYS = new Set([
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
  'coordinates',
  'trace',
  'probes',
  'bbox',
  'origin',
  'destination',
  'waypoints'
]);

const COORD_QUERY_REGEX = /([?&](?:lat|lon|lng|latitude|longitude|bbox|origin|destination)=)[^&\s]+/gi;

/**
 * Recursively scrubs coordinate fields and query parameters before writing to logs.
 */
export function redactCoordinatesForLog(value) {
  if (typeof value === 'string') {
    return value.replace(COORD_QUERY_REGEX, '$1[REDACTED_COORD]');
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactCoordinatesForLog(item));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_COORD_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED_COORD]';
      } else {
        out[k] = redactCoordinatesForLog(v);
      }
    }
    return out;
  }
  return value;
}

export const REQUIRED_PROVIDER_SLOTS = Object.freeze([
  'tile',
  'geocoding',
  'routing',
  'traffic',
  'transit',
  'weather',
  'airQuality',
  'imageStorage',
  'ai',
  'identity'
]);

export class ProviderRegistry {
  #providers = new Map();

  /**
   * Registers a replaceable provider implementation for a given slot.
   */
  register(slot, providerInstance) {
    if (!REQUIRED_PROVIDER_SLOTS.includes(slot)) {
      throw new Error(`Unknown provider slot: ${slot}`);
    }
    if (!providerInstance || typeof providerInstance.name !== 'string') {
      throw new Error(`Provider for slot '${slot}' must declare a string 'name' property`);
    }
    this.#providers.set(slot, providerInstance);
  }

  get(slot) {
    const p = this.#providers.get(slot);
    if (!p) {
      throw new Error(`No provider registered for slot '${slot}'`);
    }
    return p;
  }

  has(slot) {
    return this.#providers.has(slot);
  }

  listRegisteredProviders() {
    const summary = {};
    for (const [slot, instance] of this.#providers.entries()) {
      summary[slot] = {
        name: instance.name,
        selfHosted: Boolean(instance.selfHosted),
        optional: Boolean(instance.optional)
      };
    }
    return summary;
  }
}

/**
 * Spatial privacy filter for opt-in GPS probe trajectories.
 * Clips the first `trimMeters` (default 500m) and last `trimMeters` (default 500m)
 * plus a random jitter (`100m..300m`) so trip origins and destinations (home/work)
 * never enter the traffic map-matching pipeline.
 */
export function haversineDistanceMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180.0;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function clipTrajectoryEndpointsForPrivacy(
  points,
  { baseTrimMeters = 500, jitterStartMeters = 150, jitterEndMeters = 150 } = {}
) {
  if (!Array.isArray(points) || points.length < 3) {
    return [];
  }

  const startThreshold = baseTrimMeters + Math.max(0, jitterStartMeters);
  const endThreshold = baseTrimMeters + Math.max(0, jitterEndMeters);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return points.filter((pt) => {
    const distFromStart = haversineDistanceMeters(firstPoint, pt);
    const distFromEnd = haversineDistanceMeters(lastPoint, pt);
    return distFromStart >= startThreshold && distFromEnd >= endThreshold;
  });
}
