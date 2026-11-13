/**
 * HEXA MAPS — Places & Business Information Module (`services/api/src/modules/places`)
 *
 * Implements `docs/01_PRODUCT_REQUIREMENTS.md` Section 4:
 * - Never invents missing business information (fields without verified data are explicitly `null`).
 * - Strictly differentiates imported OpenStreetMap geographic information (`OSM_ODBL`)
 *   from HEXA community-submitted information (`HEXA_COMMUNITY`), preserving per-field
 *   provenance and `lastVerifiedAt` timestamps.
 * - Includes an OSM `opening_hours` evaluator for common schedules (`24/7`, `Mo-Fr 09:00-18:00`, etc.).
 */

const DAY_CODES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Evaluates a standard OSM `opening_hours` expression against a given UTC/local Date.
 * Supports `"24/7"` and semicolon-separated day-range rules like `"Mo-Fr 09:00-18:00; Sa 10:00-14:00"`.
 * Returns `{ raw, isOpenNow, parseable }`. Never guesses `isOpenNow` if expression is unparseable.
 */
export function evaluateOpeningHours(rawOpeningHours, evaluationDate = new Date()) {
  if (!rawOpeningHours || !String(rawOpeningHours).trim()) {
    return null;
  }

  const raw = String(rawOpeningHours).trim();
  if (raw === '24/7') {
    return { raw, is24Hours: true, isOpenNow: true, parseable: true };
  }

  const dayIndex = evaluationDate.getUTCDay(); // 0=Su .. 6=Sa
  const minutesNow = evaluationDate.getUTCHours() * 60 + evaluationDate.getUTCMinutes();

  const rules = raw.split(';').map((s) => s.trim()).filter(Boolean);
  let matchedAnyRuleSyntax = false;
  let isOpen = false;

  for (const rule of rules) {
    const match = /^([A-Za-z,-]+)\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(rule);
    if (!match) continue;

    matchedAnyRuleSyntax = true;
    const [, daySpec, startH, startM, endH, endM] = match;
    if (dayMatchesSpec(dayIndex, daySpec)) {
      const startMinutes = Number(startH) * 60 + Number(startM);
      const endMinutes = Number(endH) * 60 + Number(endM);
      if (endMinutes >= startMinutes) {
        if (minutesNow >= startMinutes && minutesNow < endMinutes) {
          isOpen = true;
        }
      } else {
        // Overnight span (e.g., 18:00-02:00)
        if (minutesNow >= startMinutes || minutesNow < endMinutes) {
          isOpen = true;
        }
      }
    }
  }

  if (!matchedAnyRuleSyntax) {
    return { raw, is24Hours: false, isOpenNow: null, parseable: false };
  }

  return { raw, is24Hours: false, isOpenNow: isOpen, parseable: true };
}

function dayMatchesSpec(dayIndex, daySpec) {
  const parts = daySpec.split(',');
  for (const part of parts) {
    if (part.includes('-')) {
      const [startDay, endDay] = part.split('-');
      const sIdx = DAY_CODES.indexOf(startDay);
      const eIdx = DAY_CODES.indexOf(endDay);
      if (sIdx !== -1 && eIdx !== -1) {
        if (sIdx <= eIdx && dayIndex >= sIdx && dayIndex <= eIdx) return true;
        if (sIdx > eIdx && (dayIndex >= sIdx || dayIndex <= eIdx)) return true;
      }
    } else {
      if (DAY_CODES.indexOf(part) === dayIndex) return true;
    }
  }
  return false;
}

/**
 * Composes a Place Detail Profile by joining Layer 1 (`OSM_ODBL`) tags and Layer 2 (`HEXA_COMMUNITY`)
 * records without contaminating the underlying databases or inventing missing fields.
 */
export function buildPlaceProfile({
  osmRecord,
  communityOverlay = null,
  evaluationDate = new Date()
}) {
  if (!osmRecord || !osmRecord.id || !osmRecord.coordinate) {
    throw new Error('osmRecord with id and coordinate is required to build a PlaceProfile');
  }

  const tags = osmRecord.tags || {};
  const openingHours = evaluateOpeningHours(
    communityOverlay?.verifiedOpeningHours ?? tags.opening_hours ?? null,
    evaluationDate
  );

  // Explicit field-level source provenance (`OSM_ODBL` vs `HEXA_COMMUNITY`)
  const fieldProvenance = {
    name: 'OSM_ODBL',
    category: 'OSM_ODBL',
    phone: communityOverlay?.phone ? 'HEXA_COMMUNITY' : (tags.phone || tags['contact:phone'] ? 'OSM_ODBL' : null),
    website: communityOverlay?.website ? 'HEXA_COMMUNITY' : (tags.website || tags['contact:website'] ? 'OSM_ODBL' : null),
    openingHours: communityOverlay?.verifiedOpeningHours ? 'HEXA_COMMUNITY' : (tags.opening_hours ? 'OSM_ODBL' : null)
  };

  const reviews = Array.isArray(communityOverlay?.reviews) ? communityOverlay.reviews : [];
  const ratingAggregate =
    reviews.length > 0
      ? {
          averageRating: Number(
            (reviews.reduce((acc, r) => acc + Number(r.rating), 0) / reviews.length).toFixed(1)
          ),
          reviewCount: reviews.length,
          source: 'HEXA_COMMUNITY'
        }
      : null;

  return {
    id: osmRecord.id,
    name: osmRecord.name,
    category: osmRecord.category || 'place',
    formattedAddress: osmRecord.formattedAddress || null,
    coordinate: osmRecord.coordinate,
    // Never invent missing business contact details
    phone: communityOverlay?.phone ?? tags.phone ?? tags['contact:phone'] ?? null,
    website: communityOverlay?.website ?? tags.website ?? tags['contact:website'] ?? null,
    openingHours,
    wheelchairAccessible: tags.wheelchair ?? null,
    internetAccess: tags.internet_access ?? null,
    evChargingSockets: tags['socket:ccs2'] || tags['socket:type2']
      ? {
          ccs2: tags['socket:ccs2'] ? Number(tags['socket:ccs2']) : 0,
          type2: tags['socket:type2'] ? Number(tags['socket:type2']) : 0
        }
      : null,
    rating: ratingAggregate,
    reviews,
    photos: Array.isArray(communityOverlay?.photos) ? communityOverlay.photos : [],
    fieldProvenance,
    attributions: [
      {
        layer: 'GEOGRAPHIC_BASE',
        source: 'OpenStreetMap',
        license: 'ODbL-1.0',
        notice: '© OpenStreetMap contributors'
      },
      ...(communityOverlay
        ? [
            {
              layer: 'COMMUNITY_ENRICHMENT',
              source: 'HEXA Community Contributors',
              license: 'CC-BY-SA-4.0'
            }
          ]
        : [])
    ],
    lastVerifiedAt: communityOverlay?.lastVerifiedAt ?? osmRecord.osmTimestamp ?? null
  };
}
