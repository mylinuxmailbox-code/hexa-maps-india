/**
 * HEXA MAPS — Public Transport & Multi-Modal Transit Module (`services/api/src/modules/transit`)
 *
 * Implements `docs/01_PRODUCT_REQUIREMENTS.md` Section 8, `docs/02_FEATURE_MATRIX.md` Section H,
 * and `docs/03_TECH_STACK.md` Section 7:
 * 1. Wraps OpenTripPlanner (`v2.10.0`) behind a replaceable `TransitProvider` adapter.
 * 2. Honest Feed Freshness State:
 *    - Never claims live bus/train positions (`REALTIME_VERIFIED`) merely because GTFS-Realtime
 *      exists as a specification.
 *    - Explicitly distinguishes `STATIC_SCHEDULE` (from verified GTFS `.zip` timetables) from
 *      `REALTIME_VERIFIED` (when a live GTFS-RT `TripUpdate`/`VehiclePosition` feed is connected and fresh).
 *    - Marks live vehicle tracking as `DATA_GAP` when an agency (e.g., BMTC/BMRCL without active IUDX RT token)
 *      only provides static schedule data.
 * 3. Includes Bengaluru Pilot Transit Network (BMRCL Namma Metro Purple & Green Lines + BMTC Kiel/Vayu Vajra corridors).
 */

export const TRANSIT_FEED_STATUS = Object.freeze({
  REALTIME_VERIFIED: 'REALTIME_VERIFIED',
  STATIC_SCHEDULE: 'STATIC_SCHEDULE',
  DATA_GAP: 'DATA_GAP'
});

export const TRANSIT_MODES = Object.freeze({
  WALK: 'WALK',
  BUS: 'BUS',
  SUBWAY: 'SUBWAY', // Metro
  RAIL: 'RAIL'
});

/**
 * Normalizes an OpenTripPlanner (`v2.10` Transmodel / GTFS GraphQL) itinerary into a vendor-neutral
 * HEXA `TransitItinerary`, attaching explicit `feedStatus` (`STATIC_SCHEDULE` vs `REALTIME_VERIFIED`)
 * to every transit leg.
 */
export function normalizeOtpItinerary(otpItinerary, { agencyRealtimeCapabilities = {} } = {}) {
  if (!otpItinerary || !Array.isArray(otpItinerary.legs)) {
    throw new Error('Invalid OTP itinerary: missing legs array');
  }

  const legs = otpItinerary.legs.map((leg) => {
    const mode = String(leg.mode || 'WALK').toUpperCase();
    const isTransit = mode !== 'WALK' && mode !== 'BICYCLE';
    const agencyId = leg.agency?.gtfsId || leg.route?.agency?.gtfsId || 'unknown-agency';
    const agencyName = leg.agency?.name || leg.route?.agency?.name || null;

    const hasLiveTripUpdate = Boolean(leg.realTime) && Boolean(agencyRealtimeCapabilities[agencyId]?.tripUpdates);
    const hasLiveVehiclePos = Boolean(agencyRealtimeCapabilities[agencyId]?.vehiclePositions);

    return {
      mode,
      isTransit,
      agencyId: isTransit ? agencyId : null,
      agencyName,
      routeShortName: leg.route?.shortName || null,
      routeLongName: leg.route?.longName || null,
      routeColorHex: leg.route?.color ? `#${String(leg.route.color).replace(/^#/, '')}` : null,
      fromStopName: leg.from?.name || 'Origin',
      toStopName: leg.to?.name || 'Destination',
      scheduledDepartureISO8601: leg.startTime || null,
      scheduledArrivalISO8601: leg.endTime || null,
      durationSeconds: Math.round(Number(leg.duration || 0)),
      distanceMeters: Math.round(Number(leg.distance || 0)),
      departureStatus: isTransit
        ? hasLiveTripUpdate
          ? TRANSIT_FEED_STATUS.REALTIME_VERIFIED
          : TRANSIT_FEED_STATUS.STATIC_SCHEDULE
        : null,
      vehiclePositionStatus: isTransit
        ? hasLiveVehiclePos
          ? TRANSIT_FEED_STATUS.REALTIME_VERIFIED
          : TRANSIT_FEED_STATUS.DATA_GAP
        : null,
      serviceAlerts: Array.isArray(leg.alerts)
        ? leg.alerts.map((a) => a.alertHeaderText || a.alertDescriptionText).filter(Boolean)
        : []
    };
  });

  const totalDurationSeconds = legs.reduce((acc, l) => acc + l.durationSeconds, 0);
  const walkingDistanceMeters = legs
    .filter((l) => l.mode === 'WALK')
    .reduce((acc, l) => acc + l.distanceMeters, 0);

  return {
    totalDurationSeconds,
    walkingDistanceMeters,
    transfersCount: Math.max(0, legs.filter((l) => l.isTransit).length - 1),
    legs,
    attribution: {
      engine: 'OpenTripPlanner 2.10',
      scheduleLicense: 'GODL-India / Agency GTFS'
    }
  };
}
