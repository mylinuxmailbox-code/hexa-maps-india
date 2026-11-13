import test from 'node:test';
import assert from 'node:assert/strict';
import { TrafficProbeIngestionService } from '../modules/traffic-ingestion/probe-ingestion-service.mjs';
import {
  TRAFFIC_STATES,
  TrafficProcessingEngine
} from '../modules/traffic-processing/traffic-processing-engine.mjs';
import {
  resolveTrafficOverlayColor,
  evaluateTrafficAwareRoutes,
  createBengaluruSyntheticTrafficScenario
} from '../modules/traffic-publishing/traffic-publisher.mjs';

test('TrafficProbeIngestionService enforces opt-in consent, forbids account identity, and blocks teleportation/Sybil attacks', () => {
  const now = 1794550000;
  const ingestion = new TrafficProbeIngestionService({ maxSessionsPerSubnetWindow: 3 });

  // 1. Rejects missing opt-in consent
  const noConsent = ingestion.ingestBatch(
    {
      optInConsentGranted: false,
      ephemeralSessionId: 'sess-valid-1234',
      probes: [{ latitude: 12.9716, longitude: 77.5946, speedKph: 30, timestampEpoch: now - 5 }]
    },
    now
  );
  assert.equal(noConsent.accepted, false);
  assert.equal(noConsent.reason, 'OPT_IN_CONSENT_REQUIRED');

  // 2. Rejects batches carrying user account identity tokens
  const withUserToken = ingestion.ingestBatch(
    {
      optInConsentGranted: true,
      userId: 'user-account-99',
      ephemeralSessionId: 'sess-valid-1234',
      probes: [{ latitude: 12.9716, longitude: 77.5946, speedKph: 30, timestampEpoch: now - 5 }]
    },
    now
  );
  assert.equal(withUserToken.accepted, false);
  assert.equal(withUserToken.reason, 'ACCOUNT_IDENTITY_FORBIDDEN_ON_PROBE_ENDPOINT');

  // 3. Rejects GPS spoofing teleportation (jumping 5 km in 2 seconds)
  const teleportBatch = ingestion.ingestBatch(
    {
      optInConsentGranted: true,
      ephemeralSessionId: 'sess-teleport-1234',
      probes: [
        { latitude: 12.9700, longitude: 77.6000, speedKph: 30, timestampEpoch: now - 10 },
        { latitude: 13.0200, longitude: 77.6000, speedKph: 30, timestampEpoch: now - 8 }
      ]
    },
    now
  );
  assert.equal(teleportBatch.accepted, false);
  assert.equal(teleportBatch.reason, 'KINEMATIC_TELEPORTATION_DETECTED');

  // 4. Enforces subnet Sybil cap (max 3 distinct sessions from same subnet)
  for (let i = 1; i <= 3; i++) {
    const res = ingestion.ingestBatch(
      {
        optInConsentGranted: true,
        ephemeralSessionId: `sybil-sess-000${i}`,
        subnetHash: 'attacker-subnet-A',
        probes: [{ latitude: 12.9700, longitude: 77.6000, speedKph: 10, timestampEpoch: now - 5 }]
      },
      now
    );
    assert.equal(res.accepted, true);
  }
  const sybil4 = ingestion.ingestBatch(
    {
      optInConsentGranted: true,
      ephemeralSessionId: 'sybil-sess-0004',
      subnetHash: 'attacker-subnet-A',
      probes: [{ latitude: 12.9700, longitude: 77.6000, speedKph: 10, timestampEpoch: now - 5 }]
    },
    now
  );
  assert.equal(sybil4.accepted, false);
  assert.equal(sybil4.reason, 'SUBNET_SYBIL_CAP_EXCEEDED');
});

test('End-to-end Gate 5 Synthetic Bengaluru Rush-Hour Pipeline: Silk Board LIVE jam, Indiranagar k<5 NO_DATA privacy gate, and dynamic rerouting', () => {
  const now = 1794550000;
  const scenario = createBengaluruSyntheticTrafficScenario(now);
  const ingestion = new TrafficProbeIngestionService({ maxSessionsPerSubnetWindow: 20 });
  const engine = new TrafficProcessingEngine({
    graphVersionId: scenario.graphVersionId,
    directedEdges: scenario.directedEdges
  });

  // Ingest and map-match all synthetic fleet batches
  for (const batch of scenario.probeBatches) {
    const res = ingestion.ingestBatch(batch, now);
    assert.equal(res.accepted, true);
    engine.processValidatedProbes(res.validProbes, scenario.graphVersionId);
  }

  const snapshots = engine.evaluateAllEdges(now);

  // 1. Silk Board (NH 44): 12 contributors @ ~9.5 km/h -> LIVE severe congestion (Dark Red '#7F1D1D')
  const silkBoard = snapshots.get('0:2401:10');
  assert.equal(silkBoard.state, TRAFFIC_STATES.LIVE);
  assert.equal(silkBoard.contributorCount, 12);
  assert.equal(silkBoard.allowsLiveColorOverlay, true);
  assert.ok(silkBoard.effectiveSpeedKph >= 9.0 && silkBoard.effectiveSpeedKph <= 10.5);
  assert.equal(resolveTrafficOverlayColor(silkBoard), '#7F1D1D');

  // 2. Agara Bypass (SH 35): 9 contributors @ ~44 km/h on 50 km/h road -> LIVE free-flow (Green '#16A34A')
  const bypass = snapshots.get('1:9102:25');
  assert.equal(bypass.state, TRAFFIC_STATES.LIVE);
  assert.equal(bypass.contributorCount, 9);
  assert.equal(resolveTrafficOverlayColor(bypass), '#16A34A');

  // 3. Indiranagar 12th Main Residential: only 2 contributors (< k=5) -> strictly NO_DATA, color is null (NEVER green!)
  const residential = snapshots.get('2:33100:4');
  assert.equal(residential.state, TRAFFIC_STATES.NO_DATA);
  assert.equal(residential.contributorCount, 2);
  assert.equal(residential.effectiveSpeedKph, null);
  assert.equal(residential.allowsLiveColorOverlay, false);
  assert.equal(resolveTrafficOverlayColor(residential), null);

  // 4. Traffic-Aware ETA & Dynamic Rerouting:
  // Without live traffic, NH 44 (4.2 km @ 60 km/h = 252s) is faster than SH 35 (5.1 km @ 50 km/h = 367s).
  // With live Silk Board congestion, NH 44 takes ~1,600s (~26.7 min) while SH 35 takes ~414s (~6.9 min),
  // triggering an automatic dynamic reroute saving > 19 minutes!
  const routeEval = evaluateTrafficAwareRoutes(scenario.candidateRoutes, snapshots, {
    targetGraphVersionId: scenario.graphVersionId
  });

  assert.equal(routeEval.shouldDynamicallyReroute, true);
  assert.equal(routeEval.recommendedRouteId, 'route-alt-sh35');
  assert.ok(routeEval.timeSavedByRerouteSeconds > 1000);

  // 5. Graph version mismatch throws immediately
  assert.throws(() =>
    evaluateTrafficAwareRoutes(scenario.candidateRoutes, snapshots, {
      targetGraphVersionId: 'incompatible-graph-v99'
    })
  );
});
