import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEXA_DISCOVERY_CATEGORIES,
  normalizePhotonFeature,
  rankAndDeduplicateResults
} from '../modules/search/search-service.mjs';
import {
  evaluateOpeningHours,
  buildPlaceProfile
} from '../modules/places/place-profile-service.mjs';

test('Photon feature normalization, multilingual name support, and ODbL attribution', () => {
  const bengaluruCenter = { latitude: 12.9716, longitude: 77.5946 };
  const rawPhotonFeature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [77.6011, 12.9756] },
    properties: {
      osm_type: 'N',
      osm_id: 10203040,
      osm_key: 'railway',
      osm_value: 'station',
      name: 'Mahatma Gandhi Road Metro Station',
      'name:kn': 'ಮಹಾತ್ಮ ಗಾಂಧಿ ರಸ್ತೆ ಮೆಟ್ರೋ ನಿಲ್ದಾಣ',
      street: 'MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postcode: '560001',
      country: 'India',
      countrycode: 'in'
    }
  };

  const enResult = normalizePhotonFeature(rawPhotonFeature, { referenceCoord: bengaluruCenter, lang: 'en' });
  assert.equal(enResult.id, 'osm:N:10203040');
  assert.equal(enResult.category, 'transit_stations');
  assert.equal(enResult.name, 'Mahatma Gandhi Road Metro Station');
  assert.equal(enResult.countryCode, 'IN');
  assert.ok(enResult.distanceMeters > 0 && enResult.distanceMeters < 1000);
  assert.equal(enResult.attribution.license, 'ODbL-1.0');

  // Kannada multilingual resolution
  const knResult = normalizePhotonFeature(rawPhotonFeature, { referenceCoord: bengaluruCenter, lang: 'kn' });
  assert.equal(knResult.name, 'ಮಹಾತ್ಮ ಗಾಂಧಿ ರಸ್ತೆ ಮೆಟ್ರೋ ನಿಲ್ದಾಣ');
  assert.deepEqual(knResult.alternateNames, ['Mahatma Gandhi Road Metro Station']);
});

test('Search ranking and spatial deduplication collapse duplicate OSM node and way POIs within 60m', () => {
  const refCoord = { latitude: 12.9716, longitude: 77.5946 };

  const candidates = [
    // Duplicate 1: OSM Node for Bowring Hospital
    {
      id: 'osm:N:1001',
      name: 'Bowring and Lady Curzon Hospital',
      category: 'hospitals',
      formattedAddress: 'Shivajinagar, Bengaluru',
      coordinate: { latitude: 12.9822, longitude: 77.6042 }
    },
    // Duplicate 2: OSM Way polygon centroid 25 meters away for the exact same hospital
    {
      id: 'osm:W:2002',
      name: 'Bowring and Lady Curzon Hospital',
      category: 'hospitals',
      formattedAddress: 'Shivajinagar, Bengaluru',
      coordinate: { latitude: 12.9823, longitude: 77.6043 }
    },
    // Distinct distant hospital
    {
      id: 'osm:W:3003',
      name: 'Victoria Hospital',
      category: 'hospitals',
      formattedAddress: 'Kalasipalyam, Bengaluru',
      coordinate: { latitude: 12.9635, longitude: 77.5740 }
    }
  ];

  const ranked = rankAndDeduplicateResults(candidates, {
    query: 'Bowring',
    referenceCoord: refCoord
  });

  // Duplicate Node + Way collapsed into 1 entry -> total 2 results
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].name, 'Bowring and Lady Curzon Hospital');
  assert.ok(ranked[0].relevanceScore > ranked[1].relevanceScore);
});

test('Discovery taxonomy covers all required categories (restaurants, hospitals, EV chargers, fuel, ATMs, toilets, water)', () => {
  const requiredIds = [
    'restaurants', 'cafes', 'hotels', 'shops', 'hospitals', 'pharmacies',
    'schools', 'fuel_stations', 'ev_charging', 'parking', 'public_toilets',
    'drinking_water', 'atms', 'transit_stations', 'tourist_attractions'
  ];
  for (const id of requiredIds) {
    assert.ok(HEXA_DISCOVERY_CATEGORIES[id], `Missing required discovery category: ${id}`);
  }
});

test('Place profile differentiates OSM_ODBL vs HEXA_COMMUNITY provenance and never invents missing fields', () => {
  // Monday 11:30 UTC
  const evalDate = new Date('2026-11-16T11:30:00Z');

  const osmRecord = {
    id: 'osm:N:555123',
    name: 'MTR 1924 Lalbagh',
    category: 'restaurants',
    formattedAddress: '14 Lalbagh Road, Bengaluru 560027',
    coordinate: { latitude: 12.9552, longitude: 77.5855 },
    osmTimestamp: '2026-10-01T00:00:00Z',
    tags: {
      opening_hours: 'Tu-Su 06:30-11:00; Mo-Fr 09:00-18:00',
      wheelchair: 'limited'
      // Notice: no phone or website in OSM tags
    }
  };

  // Case A: Pure OSM record without community overlay -> phone and website are strictly null
  const pureOsmProfile = buildPlaceProfile({ osmRecord, evaluationDate: evalDate });
  assert.equal(pureOsmProfile.phone, null);
  assert.equal(pureOsmProfile.website, null);
  assert.equal(pureOsmProfile.rating, null);
  assert.equal(pureOsmProfile.openingHours.isOpenNow, true);
  assert.equal(pureOsmProfile.fieldProvenance.openingHours, 'OSM_ODBL');
  assert.equal(pureOsmProfile.attributions.length, 1);

  // Case B: Enriched with HEXA Community overlay -> provenance explicitly marks HEXA_COMMUNITY
  const enrichedProfile = buildPlaceProfile({
    osmRecord,
    communityOverlay: {
      phone: '+91 80 2222 0022',
      lastVerifiedAt: '2026-11-12T08:00:00Z',
      reviews: [
        { authorDisplayName: 'Aarav', rating: 5, comment: 'Classic masala dosa', createdAt: '2026-11-10T00:00:00Z' },
        { authorDisplayName: 'Diya', rating: 4, comment: 'Busy on weekends', createdAt: '2026-11-11T00:00:00Z' }
      ]
    },
    evaluationDate: evalDate
  });

  assert.equal(enrichedProfile.phone, '+91 80 2222 0022');
  assert.equal(enrichedProfile.fieldProvenance.phone, 'HEXA_COMMUNITY');
  assert.equal(enrichedProfile.fieldProvenance.name, 'OSM_ODBL');
  assert.equal(enrichedProfile.rating.averageRating, 4.5);
  assert.equal(enrichedProfile.rating.reviewCount, 2);
  assert.equal(enrichedProfile.attributions.length, 2);
  assert.equal(enrichedProfile.lastVerifiedAt, '2026-11-12T08:00:00Z');
});
