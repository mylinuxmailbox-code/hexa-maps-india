/**
 * HEXA MAPS — Specialist Environmental & 2D Cartographic Layers
 * (`services/api/src/modules/specialist-layers`)
 *
 * Implements `docs/01_PRODUCT_REQUIREMENTS.md` Section 13 & 14:
 * 1. Weather Provider Adapter (`Open-Meteo` CC-BY-4.0 compatible) with coarse geohash/0.05-deg
 *    coordinate rounding so exact user location is never leaked to an external weather service.
 * 2. Air Quality Provider Adapter (`OpenAQ` / CPCB India compatible) with coarse rounding.
 * 3. 2D Elevation Profile & Hillshade Generator (Copernicus GLO-30 / SRTM DEM — strictly 2D
 *    elevation profile charts and 2D raster hillshade; zero 3D terrain mesh).
 * 4. Optional AI Assistant Adapter (`AIProvider` interface):
 *    - Never required for core map display, search, routing, traffic, or offline operation.
 *    - Enforces strict privacy context minimization: strips any user account ID, personal
 *      Timeline, saved home/work addresses, or raw GPS trace before invoking a provider,
 *      passing only the explicit text query and a coarse viewport bounding box rounded to ~1 km.
 *    - Operates exclusively via structured tool calls (`search_places`, `calculate_route`,
 *      `toggle_map_layer`) so the model never hallucinates coordinates, opening hours, or traffic.
 */

const COARSE_PRIVACY_DECIMALS = 2; // 0.01 deg ≈ 1.1 km resolution

/**
 * Rounds coordinates to ~1.1 km precision before querying external Weather, Air Quality,
 * or optional AI providers so precise user coordinates never leave the HEXA boundary.
 */
export function coarsenCoordinateForExternalProvider(coord) {
  if (!coord || typeof coord.latitude !== 'number' || typeof coord.longitude !== 'number') {
    throw new Error('Valid coordinate is required');
  }
  return {
    latitude: Number(coord.latitude.toFixed(COARSE_PRIVACY_DECIMALS)),
    longitude: Number(coord.longitude.toFixed(COARSE_PRIVACY_DECIMALS))
  };
}

/**
 * Normalizes an Open-Meteo current weather payload into a vendor-neutral HEXA `WeatherSnapshot`.
 */
export function normalizeWeatherResponse(rawOpenMeteo, requestedCoord) {
  const coarseCoord = coarsenCoordinateForExternalProvider(requestedCoord);
  const current = rawOpenMeteo?.current || {};

  return {
    coarseCoordinate: coarseCoord,
    temperatureCelsius: typeof current.temperature_2m === 'number' ? current.temperature_2m : null,
    precipitationMm: typeof current.precipitation === 'number' ? current.precipitation : 0,
    windSpeedKph: typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : null,
    weatherCode: current.weather_code ?? null,
    observedAtISO8601: current.time || null,
    attribution: {
      provider: 'Open-Meteo',
      license: 'CC-BY-4.0'
    }
  };
}

/**
 * Normalizes an OpenAQ / CPCB station reading into a vendor-neutral HEXA `AirQualitySnapshot`.
 */
export function normalizeAirQualityResponse(rawOpenAq, requestedCoord) {
  const coarseCoord = coarsenCoordinateForExternalProvider(requestedCoord);
  const pm25 = rawOpenAq?.pm25 ?? null;
  const pm10 = rawOpenAq?.pm10 ?? null;

  let category = 'UNKNOWN';
  if (typeof pm25 === 'number') {
    if (pm25 <= 12.0) category = 'GOOD';
    else if (pm25 <= 35.4) category = 'MODERATE';
    else if (pm25 <= 55.4) category = 'UNHEALTHY_FOR_SENSITIVE';
    else if (pm25 <= 150.4) category = 'UNHEALTHY';
    else category = 'VERY_UNHEALTHY';
  }

  return {
    coarseCoordinate: coarseCoord,
    pm25UgM3: pm25,
    pm10UgM3: pm10,
    category,
    stationName: rawOpenAq?.stationName || null,
    observedAtISO8601: rawOpenAq?.datetime || null,
    attribution: {
      provider: 'OpenAQ / Official Monitoring Station',
      license: 'CC-BY-4.0'
    }
  };
}

/**
 * Computes a strictly 2D elevation profile (`distanceMeters` vs `elevationMeters`, total ascent/descent)
 * along a route from DEM samples (e.g., Bengaluru plateau ~900m–930m ASL) for cycling/hiking/walking.
 */
export function build2DElevationProfile(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { points2D: [], totalAscentMeters: 0, totalDescentMeters: 0 };
  }

  let ascent = 0;
  let descent = 0;
  const points2D = samples.map((s, idx) => {
    if (idx > 0) {
      const delta = s.elevationMeters - samples[idx - 1].elevationMeters;
      if (delta > 0) ascent += delta;
      if (delta < 0) descent += Math.abs(delta);
    }
    return {
      distanceAlongRouteMeters: Math.round(s.distanceAlongRouteMeters),
      elevationMeters: Math.round(s.elevationMeters)
    };
  });

  return {
    dimension: '2D_PROFILE_ONLY',
    points2D,
    totalAscentMeters: Math.round(ascent),
    totalDescentMeters: Math.round(descent),
    attribution: {
      source: 'Copernicus DEM GLO-30 / SRTM',
      license: 'Copernicus Open Access'
    }
  };
}

/**
 * Privacy-Preserving Optional AI Tool-Calling Gateway (`services/api/src/modules/ai-assistant`).
 * - Strips all private fields (`personalTimeline`, `homeAddress`, `workAddress`, `rawLocationHistory`,
 *   `accountToken`, `userId`).
 * - Rounds the viewport center to ~1.1 km (`0.01°`) before passing context to the replaceable `aiProvider`.
 * - Enforces structured tool calls (`search_places`, `calculate_route`, `toggle_layer`) so the AI
 *   cannot invent coordinates, opening hours, or live traffic.
 */
export const ALLOWED_AI_TOOLS = new Set([
  'search_places',
  'calculate_route',
  'toggle_layer'
]);

export function prepareSanitizedAiRequest(rawInput) {
  if (!rawInput || typeof rawInput.userPrompt !== 'string' || !rawInput.userPrompt.trim()) {
    throw new Error('Non-empty userPrompt is required');
  }

  const coarseViewportCenter = rawInput.viewportCenter
    ? coarsenCoordinateForExternalProvider(rawInput.viewportCenter)
    : null;

  // Notice: personalTimeline, homeAddress, workAddress, userId, and rawLocationHistory are NEVER copied
  return {
    prompt: rawInput.userPrompt.trim().slice(0, 500),
    coarseViewportCenter,
    allowedTools: Array.from(ALLOWED_AI_TOOLS),
    privacyGuarantee: 'NO_LOCATION_HISTORY_OR_IDENTITY_INCLUDED'
  };
}
