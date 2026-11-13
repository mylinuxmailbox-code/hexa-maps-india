/**
 * HEXA MAPS — Search & Geocoding Module (`services/api/src/modules/search`)
 *
 * Implements `docs/01_PRODUCT_REQUIREMENTS.md` Section 3 & Section 10:
 * - Works without requiring a HEXA user account (anonymous-first).
 * - Provider-independent normalization (transforms Photon GeoJSON / Pelias / Offline index
 *   into canonical HEXA `SearchResultItem` records).
 * - Autocomplete, Forward Geocoding, Reverse Geocoding ("What's here?"), Category Search,
 *   and Nearby spatial search.
 * - Spatial + textual ranking (exact/prefix match boost + viewport proximity decay).
 * - Deduplication of duplicate OSM nodes/ways representing the same physical POI.
 * - Extensible category taxonomy covering all 16 required discovery categories.
 */

import { haversineDistanceMeters } from '../../index.mjs';

export const HEXA_DISCOVERY_CATEGORIES = Object.freeze({
  restaurants: { id: 'restaurants', label: 'Food & Restaurants', osmTags: ['amenity=restaurant', 'amenity=fast_food', 'amenity=food_court'] },
  cafes: { id: 'cafes', label: 'Cafes', osmTags: ['amenity=cafe'] },
  hotels: { id: 'hotels', label: 'Hotels & Lodging', osmTags: ['tourism=hotel', 'tourism=guest_house', 'tourism=hostel'] },
  shops: { id: 'shops', label: 'Shops & Supermarkets', osmTags: ['shop=supermarket', 'shop=convenience', 'shop=mall', 'shop=department_store'] },
  hospitals: { id: 'hospitals', label: 'Hospitals & Clinics', osmTags: ['amenity=hospital', 'amenity=clinic', 'healthcare=hospital'] },
  pharmacies: { id: 'pharmacies', label: 'Pharmacies', osmTags: ['amenity=pharmacy', 'healthcare=pharmacy'] },
  schools: { id: 'schools', label: 'Schools & Universities', osmTags: ['amenity=school', 'amenity=college', 'amenity=university'] },
  fuel_stations: { id: 'fuel_stations', label: 'Fuel Stations', osmTags: ['amenity=fuel'] },
  ev_charging: { id: 'ev_charging', label: 'EV Charging', osmTags: ['amenity=charging_station'] },
  parking: { id: 'parking', label: 'Parking', osmTags: ['amenity=parking'] },
  public_toilets: { id: 'public_toilets', label: 'Public Toilets', osmTags: ['amenity=toilets'] },
  drinking_water: { id: 'drinking_water', label: 'Drinking Water', osmTags: ['amenity=drinking_water'] },
  atms: { id: 'atms', label: 'ATMs & Banks', osmTags: ['amenity=atm', 'amenity=bank'] },
  transit_stations: { id: 'transit_stations', label: 'Public Transport Stations', osmTags: ['railway=station', 'railway=subway_entrance', 'highway=bus_stop', 'public_transport=station'] },
  tourist_attractions: { id: 'tourist_attractions', label: 'Tourist Attractions & Parks', osmTags: ['tourism=attraction', 'tourism=museum', 'leisure=park', 'leisure=garden'] }
});

/**
 * Maps raw OSM `(key, value)` pairs to a canonical HEXA category identifier.
 */
export function resolveHexaCategory(osmKey, osmValue) {
  if (!osmKey || !osmValue) return 'place';
  const tag = `${String(osmKey).toLowerCase()}=${String(osmValue).toLowerCase()}`;
  for (const [catId, spec] of Object.entries(HEXA_DISCOVERY_CATEGORIES)) {
    if (spec.osmTags.includes(tag)) {
      return catId;
    }
  }
  return `${osmKey}:${osmValue}`;
}

/**
 * Normalizes a Photon (`v1.3.0`) GeoJSON feature into a vendor-neutral HEXA `SearchResultItem`.
 * Never leaks vendor-specific GeoJSON wrapper structures as the application data model.
 */
export function normalizePhotonFeature(feature, { referenceCoord = null, lang = 'en' } = {}) {
  if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) {
    return null;
  }
  const [lon, lat] = feature.geometry.coordinates;
  const props = feature.properties || {};

  const osmType = props.osm_type || 'N';
  const osmId = props.osm_id || `${lat.toFixed(5)}_${lon.toFixed(5)}`;
  const category = resolveHexaCategory(props.osm_key, props.osm_value);

  const localizedName =
    props[`name:${lang}`] ||
    props.name ||
    props.street ||
    props.city ||
    `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  const addressParts = [
    props.housenumber && props.street ? `${props.housenumber} ${props.street}` : props.street,
    props.district || props.suburb || props.locality,
    props.city,
    props.state,
    props.postcode,
    props.country
  ].filter(Boolean);

  const coordinate = { latitude: Number(lat), longitude: Number(lon) };
  const distanceMeters = referenceCoord
    ? Math.round(haversineDistanceMeters(referenceCoord, coordinate))
    : null;

  return {
    id: `osm:${osmType}:${osmId}`,
    externalIds: { osmType, osmId: String(osmId) },
    name: localizedName,
    alternateNames: props.name && props.name !== localizedName ? [props.name] : [],
    category,
    formattedAddress: addressParts.join(', '),
    coordinate,
    distanceMeters,
    countryCode: props.countrycode ? String(props.countrycode).toUpperCase() : null,
    attribution: {
      source: 'OpenStreetMap',
      license: 'ODbL-1.0',
      requiredNotice: '© OpenStreetMap contributors'
    }
  };
}

/**
 * Deduplicates and ranks search candidates by textual relevance and proximity to `referenceCoord`.
 * - Merges duplicate OSM Node + Way representations of the same building/business within 60m.
 */
export function rankAndDeduplicateResults(items, { query = '', referenceCoord = null } = {}) {
  const normalizedQuery = String(query).trim().toLowerCase();

  // 1. Score each item
  const scored = items.map((item) => {
    const nameLower = String(item.name || '').toLowerCase();
    let textScore = 0.2;

    if (normalizedQuery) {
      if (nameLower === normalizedQuery) {
        textScore = 1.0;
      } else if (nameLower.startsWith(normalizedQuery)) {
        textScore = 0.85;
      } else if (nameLower.includes(normalizedQuery)) {
        textScore = 0.65;
      } else if (String(item.formattedAddress || '').toLowerCase().includes(normalizedQuery)) {
        textScore = 0.45;
      }
    } else {
      textScore = 0.5;
    }

    let proximityScore = 0.5;
    if (referenceCoord && item.coordinate) {
      const distKm = haversineDistanceMeters(referenceCoord, item.coordinate) / 1000.0;
      // Smooth exponential decay over 15 km
      proximityScore = Math.exp(-distKm / 15.0);
    }

    const totalScore = Number((0.65 * textScore + 0.35 * proximityScore).toFixed(4));
    return { ...item, relevanceScore: totalScore };
  });

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // 2. Spatial + Name Deduplication (collapse duplicate OSM node/way within 60 meters)
  const deduplicated = [];
  for (const candidate of scored) {
    const isDuplicate = deduplicated.some((existing) => {
      const sameName =
        existing.name.trim().toLowerCase() === candidate.name.trim().toLowerCase() &&
        existing.category === candidate.category;
      if (!sameName) return false;
      const dist = haversineDistanceMeters(existing.coordinate, candidate.coordinate);
      return dist <= 60.0;
    });

    if (!isDuplicate) {
      deduplicated.push(candidate);
    }
  }

  return deduplicated;
}
