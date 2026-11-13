import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSIT_FEED_STATUS,
  normalizeOtpItinerary
} from '../modules/transit/transit-service.mjs';
import {
  coarsenCoordinateForExternalProvider,
  normalizeWeatherResponse,
  normalizeAirQualityResponse,
  build2DElevationProfile,
  prepareSanitizedAiRequest
} from '../modules/specialist-layers/specialist-layers-service.mjs';

test('OpenTripPlanner Bengaluru itinerary distinguishes STATIC_SCHEDULE vs REALTIME_VERIFIED and flags live BMTC position DATA_GAP honestly', () => {
  const mockOtpItinerary = {
    legs: [
      {
        mode: 'WALK',
        from: { name: 'Brigade Road' },
        to: { name: 'MG Road Metro Station' },
        duration: 240,
        distance: 310
      },
      {
        mode: 'SUBWAY',
        realTime: false,
        agency: { gtfsId: 'bmrcl', name: 'BMRCL Namma Metro' },
        route: { shortName: 'Purple Line', longName: 'Whitefield - Challaghatta', color: '7E22CE' },
        from: { name: 'MG Road Metro Station' },
        to: { name: 'Majestic (Nadaprabhu Kempegowda)' },
        startTime: '2026-11-13T10:35:00+05:30',
        endTime: '2026-11-13T10:44:00+05:30',
        duration: 540,
        distance: 4800,
        alerts: [{ alertHeaderText: 'Peak frequency every 4 minutes' }]
      },
      {
        mode: 'BUS',
        realTime: false,
        agency: { gtfsId: 'bmtc', name: 'BMTC' },
        route: { shortName: 'KIA-9', longName: 'Kempegowda Bus Station - Airport' },
        from: { name: 'Majestic Bus Stand' },
        to: { name: 'Hebbal Flyover' },
        duration: 1500,
        distance: 11200
      }
    ]
  };

  // Without live GTFS-RT feeds configured, departures are strictly STATIC_SCHEDULE and vehicle positions are DATA_GAP
  const normalized = normalizeOtpItinerary(mockOtpItinerary, {
    agencyRealtimeCapabilities: {
      bmrcl: { tripUpdates: false, vehiclePositions: false },
      bmtc: { tripUpdates: false, vehiclePositions: false }
    }
  });

  assert.equal(normalized.transfersCount, 1);
  assert.equal(normalized.walkingDistanceMeters, 310);

  const metroLeg = normalized.legs[1];
  assert.equal(metroLeg.routeShortName, 'Purple Line');
  assert.equal(metroLeg.routeColorHex, '#7E22CE');
  assert.equal(metroLeg.departureStatus, TRANSIT_FEED_STATUS.STATIC_SCHEDULE);
  assert.equal(metroLeg.vehiclePositionStatus, TRANSIT_FEED_STATUS.DATA_GAP);
  assert.deepEqual(metroLeg.serviceAlerts, ['Peak frequency every 4 minutes']);

  // When an operator enables verified BMTC GTFS-RT feeds, status transitions to REALTIME_VERIFIED
  mockOtpItinerary.legs[2].realTime = true;
  const withLiveBmtc = normalizeOtpItinerary(mockOtpItinerary, {
    agencyRealtimeCapabilities: {
      bmtc: { tripUpdates: true, vehiclePositions: true }
    }
  });
  assert.equal(withLiveBmtc.legs[2].departureStatus, TRANSIT_FEED_STATUS.REALTIME_VERIFIED);
  assert.equal(withLiveBmtc.legs[2].vehiclePositionStatus, TRANSIT_FEED_STATUS.REALTIME_VERIFIED);
});

test('Weather, Air Quality, and 2D Elevation layers coarsen coordinates to ~1.1km and never introduce 3D meshes', () => {
  const exactCoord = { latitude: 12.9715987, longitude: 77.5945621 };
  const coarse = coarsenCoordinateForExternalProvider(exactCoord);
  assert.equal(coarse.latitude, 12.97);
  assert.equal(coarse.longitude, 77.59);

  const weather = normalizeWeatherResponse(
    { current: { temperature_2m: 26.4, precipitation: 0.0, wind_speed_10m: 14.2, weather_code: 1 } },
    exactCoord
  );
  assert.equal(weather.temperatureCelsius, 26.4);
  assert.deepEqual(weather.coarseCoordinate, { latitude: 12.97, longitude: 77.59 });

  const aqi = normalizeAirQualityResponse(
    { pm25: 28.5, pm10: 54.0, stationName: 'BTM Layout CPCB' },
    exactCoord
  );
  assert.equal(aqi.category, 'MODERATE');

  const elevation2D = build2DElevationProfile([
    { distanceAlongRouteMeters: 0, elevationMeters: 905 },
    { distanceAlongRouteMeters: 1000, elevationMeters: 922 },
    { distanceAlongRouteMeters: 2000, elevationMeters: 914 }
  ]);
  assert.equal(elevation2D.dimension, '2D_PROFILE_ONLY');
  assert.equal(elevation2D.totalAscentMeters, 17);
  assert.equal(elevation2D.totalDescentMeters, 8);
});

test('Optional AI gateway strips personal timeline, home/work addresses, and exact coordinates before calling provider', () => {
  const rawInputWithSensitiveData = {
    userPrompt: 'Find EV fast chargers near Cubbon Park',
    viewportCenter: { latitude: 12.976345, longitude: 77.592912 },
    userId: 'secret-user-123',
    homeAddress: '123 Private Residency, Indiranagar',
    personalTimeline: [{ latitude: 12.91, longitude: 77.62, timestamp: 1794550000 }]
  };

  const sanitized = prepareSanitizedAiRequest(rawInputWithSensitiveData);
  const serialized = JSON.stringify(sanitized);

  assert.ok(!serialized.includes('secret-user-123'));
  assert.ok(!serialized.includes('Indiranagar'));
  assert.ok(!serialized.includes('12.976345'), 'Exact coordinate must be coarsened');
  assert.deepEqual(sanitized.coarseViewportCenter, { latitude: 12.98, longitude: 77.59 });
  assert.deepEqual(sanitized.allowedTools, ['search_places', 'calculate_route', 'toggle_layer']);
});
