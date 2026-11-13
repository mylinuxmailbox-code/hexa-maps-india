/**
 * HEXA MAPS — Routing Module (`services/api/src/modules/routing`)
 *
 * Implements `docs/01_PRODUCT_REQUIREMENTS.md` Section 5 & `ADR-0002`:
 * - Provider-independent routing interface wrapping Valhalla (`3.6.3+`).
 * - Modes: `driving`, `walking`, `cycling`, `hiking`, `wheelchair_accessible`.
 * - Costing options: `avoidTolls`, `avoidHighways`, `avoidFerries`, `preferCyclingPaths`,
 *   `preferAccessiblePaths`, `alternatesCount`, `optimizeWaypoints`.
 * - Decodes precision-6 encoded polylines (`polyline6`) used by Valhalla into 2D coordinates.
 * - Integrates `@hexa-maps/highway-shields` to attach country-specific highway route shields
 *   directly to route maneuvers (e.g., `"Merge onto NH 44"` carries the Indian yellow/black NH 44 badge).
 * - Preserves honest traffic confidence state (`LIVE`, `HISTORICAL`, `ESTIMATED`, `NO_DATA`)
 *   and `graph_version_id` on every returned route.
 */

import { HighwayShieldResolver } from '../../../../../packages/highway-shields/src/index.mjs';

export const HEXA_ROUTING_MODES = Object.freeze({
  DRIVING: 'driving',
  WALKING: 'walking',
  CYCLING: 'cycling',
  HIKING: 'hiking',
  WHEELCHAIR: 'wheelchair'
});

/**
 * Decodes a Valhalla precision-6 (or precision-5) encoded polyline string into
 * an array of `{ latitude, longitude }` 2D coordinates.
 */
export function decodePolyline(encoded, precision = 6) {
  if (!encoded || typeof encoded !== 'string') return [];
  const factor = Math.pow(10, precision);
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = null;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);
    const dLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);
    const dLon = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lon += dLon;

    coordinates.push({
      latitude: Number((lat / factor).toFixed(6)),
      longitude: Number((lon / factor).toFixed(6))
    });
  }

  return coordinates;
}

/**
 * Encodes an array of `{ latitude, longitude }` coordinates into a precision-6 polyline string.
 */
export function encodePolyline(coordinates, precision = 6) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return '';
  const factor = Math.pow(10, precision);
  let output = '';
  let prevLat = 0;
  let prevLon = 0;

  const encodeSignedNumber = (num) => {
    let sgnNum = num << 1;
    if (num < 0) sgnNum = ~sgnNum;
    let encoded = '';
    while (sgnNum >= 0x20) {
      encoded += String.fromCharCode((0x20 | (sgnNum & 0x1f)) + 63);
      sgnNum >>= 5;
    }
    encoded += String.fromCharCode(sgnNum + 63);
    return encoded;
  };

  for (const pt of coordinates) {
    const lat = Math.round(pt.latitude * factor);
    const lon = Math.round(pt.longitude * factor);
    output += encodeSignedNumber(lat - prevLat);
    output += encodeSignedNumber(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }

  return output;
}

/**
 * Translates a vendor-neutral HEXA RouteRequest into a Valhalla `/route` or `/optimized_route` payload.
 */
export function buildValhallaRouteRequest({
  waypoints,
  mode = HEXA_ROUTING_MODES.DRIVING,
  options = {}
}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new Error('At least 2 waypoints (origin and destination) are required');
  }

  const locations = waypoints.map((wp, idx) => ({
    lat: Number(wp.latitude),
    lon: Number(wp.longitude),
    type: idx === 0 || idx === waypoints.length - 1 || !options.passThroughIntermediate
      ? 'break'
      : 'through'
  }));

  let costing = 'auto';
  const costingOptions = {};

  switch (mode) {
    case HEXA_ROUTING_MODES.DRIVING:
      costing = 'auto';
      costingOptions.auto = {
        use_tolls: options.avoidTolls ? 0.0 : 1.0,
        use_highways: options.avoidHighways ? 0.0 : 1.0,
        use_ferry: options.avoidFerries ? 0.0 : 1.0,
        // Enable Valhalla live + predicted traffic when available
        use_living_streets: 0.3
      };
      break;

    case HEXA_ROUTING_MODES.CYCLING:
      costing = 'bicycle';
      costingOptions.bicycle = {
        bicycle_type: options.bicycleType || 'Hybrid',
        use_roads: options.preferCyclingPaths ? 0.15 : 0.5,
        use_ferry: options.avoidFerries ? 0.0 : 1.0,
        use_hills: 0.4
      };
      break;

    case HEXA_ROUTING_MODES.WALKING:
      costing = 'pedestrian';
      costingOptions.pedestrian = {
        use_ferry: options.avoidFerries ? 0.0 : 1.0,
        walkway_factor: 0.9,
        max_hiking_difficulty: 1
      };
      break;

    case HEXA_ROUTING_MODES.HIKING:
      costing = 'pedestrian';
      costingOptions.pedestrian = {
        use_ferry: options.avoidFerries ? 0.0 : 1.0,
        max_hiking_difficulty: 3,
        use_lit: 0.2
      };
      break;

    case HEXA_ROUTING_MODES.WHEELCHAIR:
      costing = 'pedestrian';
      costingOptions.pedestrian = {
        type: 'wheelchair',
        max_grade: 6,
        step_penalty: 3000,
        use_ferry: options.avoidFerries ? 0.0 : 1.0
      };
      break;

    default:
      throw new Error(`Unsupported routing mode: ${mode}`);
  }

  return {
    endpoint: options.optimizeWaypoints && waypoints.length > 3 ? 'optimized_route' : 'route',
    payload: {
      locations,
      costing,
      costing_options: costingOptions,
      alternates: Math.min(3, Math.max(0, Number(options.alternatesCount ?? 2))),
      units: 'kilometers',
      language: options.language || 'en-US',
      directions_options: { units: 'kilometers', language: options.language || 'en-US' },
      date_time: { type: 0 } // Current time so Valhalla consults live traffic.tar & historical speeds
    }
  };
}

/**
 * Normalizes a Valhalla `trip` object (and any `alternates`) into the vendor-neutral
 * HEXA `RoutePlanResponse`, enriching maneuvers with country-specific highway shields.
 */
export function normalizeValhallaRouteResponse(
  valhallaResponse,
  {
    countryNetworkHint = 'IN:NH',
    theme = 'light',
    graphVersionId = 'unknown',
    trafficConfidence = 'ESTIMATED',
    elevationProfile2D = []
  } = {}
) {
  if (!valhallaResponse || !valhallaResponse.trip) {
    throw new Error('Invalid Valhalla response: missing trip object');
  }

  const shieldResolver = new HighwayShieldResolver();

  const parseSingleTrip = (trip, isPrimary, index) => {
    const legs = Array.isArray(trip.legs) ? trip.legs : [];
    const allCoordinates = [];
    const maneuvers = [];

    for (const leg of legs) {
      const legCoords = decodePolyline(leg.shape || '', 6);
      allCoordinates.push(...legCoords);

      for (const m of leg.maneuvers || []) {
        const streetNames = Array.isArray(m.street_names) ? m.street_names : [];
        const beginStreetNames = Array.isArray(m.begin_street_names) ? m.begin_street_names : [];
        const rawRefs = [...beginStreetNames, ...streetNames].filter((name) =>
          /^(?:NH|SH|NE|I-|US|M\d|A\d|B\d|E\s?\d)/i.test(name)
        );

        const highwayShields = [];
        for (const refCandidate of rawRefs) {
          let inferredNet = countryNetworkHint;
          if (/^SH\b/i.test(refCandidate) && countryNetworkHint.startsWith('IN:')) {
            inferredNet = 'IN:SH';
          } else if (/^NE\b/i.test(refCandidate) && countryNetworkHint.startsWith('IN:')) {
            inferredNet = 'IN:NE';
          }
          const resolved = shieldResolver.resolve({
            network: m.network || inferredNet,
            ref: refCandidate,
            theme
          });
          if (resolved && !highwayShields.some((b) => b.spriteKey === resolved.spriteKey)) {
            highwayShields.push(resolved);
          }
        }

        maneuvers.push({
          type: m.type ?? 1,
          instruction: m.instruction || '',
          verbalPreTransitionInstruction: m.verbal_pre_transition_instruction || m.instruction || '',
          verbalPostTransitionInstruction: m.verbal_post_transition_instruction || null,
          streetNames,
          lengthMeters: Math.round(Number(m.length || 0) * 1000),
          durationSeconds: Math.round(Number(m.time || 0)),
          beginShapeIndex: m.begin_shape_index ?? 0,
          endShapeIndex: m.end_shape_index ?? 0,
          toll: Boolean(m.toll),
          rough: Boolean(m.rough),
          highwayShields
        });
      }
    }

    const summary = trip.summary || {};
    return {
      routeId: isPrimary ? 'route-primary' : `route-alt-${index}`,
      isPrimary,
      distanceMeters: Math.round(Number(summary.length || 0) * 1000),
      durationSeconds: Math.round(Number(summary.time || 0)),
      hasTolls: Boolean(summary.has_toll),
      hasHighways: Boolean(summary.has_highway),
      hasFerries: Boolean(summary.has_ferry),
      boundingBox: [
        summary.min_lon ?? 0,
        summary.min_lat ?? 0,
        summary.max_lon ?? 0,
        summary.max_lat ?? 0
      ],
      geometry2D: allCoordinates,
      maneuvers,
      elevationProfile2D,
      trafficMetadata: {
        state: trafficConfidence,
        graphVersionId,
        allowsLiveColorOverlay:
          trafficConfidence === 'LIVE' || trafficConfidence === 'LIVE_LOW_CONFIDENCE'
      }
    };
  };

  const primaryRoute = parseSingleTrip(valhallaResponse.trip, true, 0);
  const alternateRoutes = (valhallaResponse.alternates || []).map((alt, idx) =>
    parseSingleTrip(alt.trip, false, idx + 1)
  );

  return {
    primaryRoute,
    alternateRoutes,
    attribution: {
      routingEngine: 'Valhalla',
      mapData: '© OpenStreetMap contributors (ODbL 1.0)'
    }
  };
}
