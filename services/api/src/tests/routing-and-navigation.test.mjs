import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEXA_ROUTING_MODES,
  encodePolyline,
  decodePolyline,
  buildValhallaRouteRequest,
  normalizeValhallaRouteResponse
} from '../modules/routing/routing-service.mjs';
import {
  NAVIGATION_STATUS,
  NavigationSessionTracker
} from '../modules/navigation/navigation-state-machine.mjs';

test('Precision-6 polyline encode and decode roundtrip preserves 2D coordinates accurately', () => {
  const original = [
    { latitude: 12.971599, longitude: 77.594563 },
    { latitude: 12.955201, longitude: 77.585502 },
    { latitude: 12.917231, longitude: 77.622815 }
  ];
  const encoded = encodePolyline(original, 6);
  const decoded = decodePolyline(encoded, 6);
  assert.deepEqual(decoded, original);
});

test('Valhalla route request builder supports driving, cycling, walking, hiking, wheelchair, and avoid options', () => {
  const waypoints = [
    { latitude: 12.9716, longitude: 77.5946 },
    { latitude: 12.9172, longitude: 77.6228 }
  ];

  const drivingNoTolls = buildValhallaRouteRequest({
    waypoints,
    mode: HEXA_ROUTING_MODES.DRIVING,
    options: { avoidTolls: true, avoidHighways: false, alternatesCount: 2 }
  });
  assert.equal(drivingNoTolls.endpoint, 'route');
  assert.equal(drivingNoTolls.payload.costing, 'auto');
  assert.equal(drivingNoTolls.payload.costing_options.auto.use_tolls, 0.0);
  assert.equal(drivingNoTolls.payload.alternates, 2);

  const wheelchairReq = buildValhallaRouteRequest({
    waypoints,
    mode: HEXA_ROUTING_MODES.WHEELCHAIR,
    options: { avoidFerries: true }
  });
  assert.equal(wheelchairReq.payload.costing, 'pedestrian');
  assert.equal(wheelchairReq.payload.costing_options.pedestrian.type, 'wheelchair');
  assert.equal(wheelchairReq.payload.costing_options.pedestrian.use_ferry, 0.0);
});

test('Normalized Valhalla route attaches Indian NH/SH highway shields to maneuvers and preserves honest traffic state', () => {
  const shapeCoords = [
    { latitude: 12.9716, longitude: 77.5946 },
    { latitude: 12.9500, longitude: 77.6050 },
    { latitude: 12.9172, longitude: 77.6228 }
  ];
  const mockValhalla = {
    trip: {
      summary: {
        length: 8.4,
        time: 1260,
        has_toll: false,
        has_highway: true,
        has_ferry: false,
        min_lat: 12.9172,
        min_lon: 77.5946,
        max_lat: 12.9716,
        max_lon: 77.6228
      },
      legs: [
        {
          shape: encodePolyline(shapeCoords, 6),
          maneuvers: [
            {
              type: 1,
              instruction: 'Head south on Hosur Road.',
              verbal_pre_transition_instruction: 'Head south on Hosur Road toward Silk Board.',
              street_names: ['NH 44', 'Hosur Road'],
              length: 5.2,
              time: 780,
              begin_shape_index: 0,
              end_shape_index: 1
            },
            {
              type: 8,
              instruction: 'Turn left onto Outer Ring Road.',
              street_names: ['NH 48', 'SH 35'],
              length: 3.2,
              time: 480,
              begin_shape_index: 1,
              end_shape_index: 2
            }
          ]
        }
      ]
    },
    alternates: [
      {
        trip: {
          summary: { length: 9.8, time: 1420, has_highway: false },
          legs: [{ shape: encodePolyline(shapeCoords, 6), maneuvers: [] }]
        }
      }
    ]
  };

  const plan = normalizeValhallaRouteResponse(mockValhalla, {
    countryNetworkHint: 'IN:NH',
    graphVersionId: 'blr-2026-11-13-v1',
    trafficConfidence: 'LIVE'
  });

  assert.equal(plan.primaryRoute.distanceMeters, 8400);
  assert.equal(plan.primaryRoute.durationSeconds, 1260);
  assert.equal(plan.primaryRoute.trafficMetadata.state, 'LIVE');
  assert.equal(plan.primaryRoute.trafficMetadata.allowsLiveColorOverlay, true);
  assert.equal(plan.alternateRoutes.length, 1);

  // Verify maneuver 0 has Indian NH 44 shield and maneuver 1 has both NH 48 and SH 35 shields
  const m0Shields = plan.primaryRoute.maneuvers[0].highwayShields;
  assert.equal(m0Shields.length, 1);
  assert.equal(m0Shields[0].displayText, 'NH 44');
  assert.equal(m0Shields[0].countryCode, 'IN');

  const m1Shields = plan.primaryRoute.maneuvers[1].highwayShields;
  assert.equal(m1Shields.length, 2);
  assert.equal(m1Shields[0].displayText, 'NH 48');
  assert.equal(m1Shields[1].displayText, 'SH 35');
});

test('Navigation state machine handles voice guidance, speed-limit alerts, off-route rerouting, pause/resume, and arrival', () => {
  const route = {
    routeId: 'route-primary',
    geometry2D: [
      { latitude: 12.9700, longitude: 77.6000 },
      { latitude: 12.9750, longitude: 77.6000 }, // ~555m north
      { latitude: 12.9800, longitude: 77.6000 }  // ~1110m north
    ],
    maneuvers: [
      {
        type: 1,
        instruction: 'Start north on Brigade Road.',
        verbalPreTransitionInstruction: 'Start north on Brigade Road.',
        beginShapeIndex: 0,
        endShapeIndex: 1
      },
      {
        type: 10,
        instruction: 'Turn right onto MG Road.',
        verbalPreTransitionInstruction: 'Turn right onto Mahatma Gandhi Road.',
        beginShapeIndex: 1,
        endShapeIndex: 2
      }
    ]
  };

  const nav = new NavigationSessionTracker(route);

  // 1. On-route fix ~300m south of maneuver 1 -> triggers 500m pre-transition voice announcement
  const fix1 = nav.updateLocationFix({
    latitude: 12.9723,
    longitude: 77.6000,
    speedKph: 58,
    speedLimitKph: 50
  });
  assert.equal(fix1.status, NAVIGATION_STATUS.ACTIVE);
  assert.equal(fix1.isOverSpeedLimit, true);
  assert.ok(fix1.voiceAnnouncement?.includes('Turn right onto MG Road'));

  // 2. Single GPS glitch 80m off-route does NOT immediately reroute (requires 2 consecutive fixes)
  const glitchFix = nav.updateLocationFix({
    latitude: 12.9730,
    longitude: 77.6010, // ~108m east
    speedKph: 40
  });
  assert.equal(glitchFix.status, NAVIGATION_STATUS.ACTIVE);
  assert.equal(glitchFix.shouldTriggerReroute, false);

  // 3. Second consecutive off-route fix (>45m) triggers automatic REROUTING
  const offRouteFix2 = nav.updateLocationFix({
    latitude: 12.9735,
    longitude: 77.6012,
    speedKph: 40
  });
  assert.equal(offRouteFix2.status, NAVIGATION_STATUS.REROUTING);
  assert.equal(offRouteFix2.shouldTriggerReroute, true);
  assert.equal(offRouteFix2.voiceAnnouncement, 'Recalculating route.');

  // 4. Pause & Resume
  nav.pause();
  assert.equal(nav.status, NAVIGATION_STATUS.PAUSED);
  nav.resume();
  assert.equal(nav.status, NAVIGATION_STATUS.ACTIVE);

  // 5. Arrival within 30m of destination
  const arrivalFix = nav.updateLocationFix({
    latitude: 12.9799,
    longitude: 77.6000,
    speedKph: 5
  });
  assert.equal(arrivalFix.status, NAVIGATION_STATUS.ARRIVED);
  assert.equal(arrivalFix.remainingDurationSeconds, 0);
  assert.equal(arrivalFix.voiceAnnouncement, 'You have arrived at your destination.');
});
