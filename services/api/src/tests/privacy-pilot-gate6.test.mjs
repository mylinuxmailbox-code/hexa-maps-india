import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EphemeralProbeSessionManager,
  applyShockwaveSybilDefense,
  buildValhallaWeeklyHistoricalProfile,
  WEEKLY_5MIN_BUCKET_COUNT
} from '../modules/traffic-processing/privacy-pilot-controls.mjs';
import { TRAFFIC_STATES } from '../modules/traffic-processing/traffic-processing-engine.mjs';

test('Three-tier explicit privacy consent and 15-min / 10-km ephemeral session rotation', () => {
  const manager = new EphemeralProbeSessionManager();
  const t0 = 1794550000;
  const ptA = { latitude: 12.9716, longitude: 77.5946 };

  // 1. Default is strictly opted-out: returns null session ID
  assert.equal(manager.getOrRotateSessionForPoint(ptA, { nowEpoch: t0 }), null);
  assert.equal(manager.consent.personalTimelineEnabled, false);

  // 2. Enabling foreground traffic without foreground location is blocked
  manager.updatePermissions({ foregroundLocationEnabled: false, foregroundTrafficOptIn: true });
  assert.equal(manager.consent.foregroundTrafficOptIn, false);

  // 3. Grant foreground location + foreground traffic opt-in (background remains false)
  manager.updatePermissions({
    foregroundLocationEnabled: true,
    foregroundTrafficOptIn: true,
    backgroundTrafficOptIn: false
  });
  const sess1 = manager.getOrRotateSessionForPoint(ptA, { isBackground: false, nowEpoch: t0 });
  assert.ok(sess1 && sess1.startsWith('eph-'));

  // Background probe must be rejected until separate background permission is enabled
  assert.equal(
    manager.getOrRotateSessionForPoint(ptA, { isBackground: true, nowEpoch: t0 + 10 }),
    null
  );

  // 4. Same session within 15 min and < 10 km
  const sessSame = manager.getOrRotateSessionForPoint(
    { latitude: 12.9726, longitude: 77.5946 }, // ~111m north
    { nowEpoch: t0 + 120 }
  );
  assert.equal(sessSame, sess1);

  // 5. Automatically rotates after 15 minutes (900 seconds)
  const sessAfter15Min = manager.getOrRotateSessionForPoint(
    { latitude: 12.9736, longitude: 77.5946 },
    { nowEpoch: t0 + 905 }
  );
  assert.notEqual(sessAfter15Min, sess1);

  // 6. Automatically rotates after 10 km traveled even within 15 minutes
  const sessAfter10Km = manager.getOrRotateSessionForPoint(
    { latitude: 13.0700, longitude: 77.5946 }, // > 10.7 km north
    { nowEpoch: t0 + 1000 }
  );
  assert.notEqual(sessAfter10Km, sessAfter15Min);

  // 7. Emergency revokeAllAndPurge immediately disables all collection and purges session ID
  manager.revokeAllAndPurge();
  assert.equal(manager.currentSessionId, null);
  assert.equal(manager.getOrRotateSessionForPoint(ptA, { nowEpoch: t0 + 1010 }), null);
});

test('Shockwave Sybil anomaly detector dampens isolated fake congestion when upstream and downstream edges are in free-flow', () => {
  const snapshots = new Map([
    [
      '0:2401:9',
      {
        edgeKey: '0:2401:9',
        state: TRAFFIC_STATES.LIVE,
        effectiveSpeedKph: 56.0,
        freeFlowSpeedKph: 60.0,
        historicalSpeedKph: 50.0,
        confidenceScore: 0.92
      }
    ],
    [
      // Target edge attacked by a wagon of Sybil devices reporting 6 km/h
      '0:2401:10',
      {
        edgeKey: '0:2401:10',
        state: TRAFFIC_STATES.LIVE,
        effectiveSpeedKph: 6.0,
        freeFlowSpeedKph: 60.0,
        historicalSpeedKph: 48.0,
        confidenceScore: 0.90
      }
    ],
    [
      '0:2401:11',
      {
        edgeKey: '0:2401:11',
        state: TRAFFIC_STATES.LIVE,
        effectiveSpeedKph: 58.0,
        freeFlowSpeedKph: 60.0,
        historicalSpeedKph: 50.0,
        confidenceScore: 0.94
      }
    ]
  ]);

  const topology = new Map([
    [
      '0:2401:10',
      {
        upstreamEdgeKeys: ['0:2401:9'],
        downstreamEdgeKeys: ['0:2401:11']
      }
    ]
  ]);

  const hardened = applyShockwaveSybilDefense(snapshots, topology);
  const target = hardened.get('0:2401:10');

  assert.equal(target.sybilAnomalyDetected, true);
  assert.equal(target.state, TRAFFIC_STATES.LIVE_LOW_CONFIDENCE);
  assert.ok(target.effectiveSpeedKph >= 30.0, 'Dampened speed must not allow fake 6 km/h roadblock');
});

test('Valhalla 168-hour weekly historical traffic profile builder generates 2,016 five-minute buckets', () => {
  const profile = buildValhallaWeeklyHistoricalProfile({
    edgeKey: '0:2401:10',
    freeFlowSpeedKph: 60,
    constrainedFlowSpeedKph: 36,
    bucketObservations: {
      // Monday 09:00 AM rush hour (bucket index: 1 * 288 + 108 = 396)
      396: { speedKph: 14.2, contributorCount: 25 },
      // Sparse bucket with k=2 (<5) must be ignored in favor of baseline
      397: { speedKph: 5.0, contributorCount: 2 }
    }
  });

  assert.equal(profile.bucketCount, WEEKLY_5MIN_BUCKET_COUNT);
  assert.equal(profile.weeklySpeedBucketsKph.length, 2016);
  assert.equal(profile.weeklySpeedBucketsKph[396], 14);
  assert.equal(profile.weeklySpeedBucketsKph[397], 36); // Used constrainedFlowSpeedKph because k < 5
});
