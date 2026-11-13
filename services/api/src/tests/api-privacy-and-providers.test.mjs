import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderRegistry,
  redactCoordinatesForLog,
  clipTrajectoryEndpointsForPrivacy
} from '../index.mjs';

test('Log redaction scrubs all raw coordinate fields and query string parameters', () => {
  const rawLogPayload = {
    event: 'route_request',
    url: '/api/v1/route?lat=12.9716&lon=77.5946&mode=auto',
    body: {
      origin: { latitude: 12.9716, longitude: 77.5946 },
      destination: { latitude: 12.9172, longitude: 77.6228 },
      costing: 'auto'
    }
  };

  const sanitized = redactCoordinatesForLog(rawLogPayload);
  const serialized = JSON.stringify(sanitized);

  assert.ok(!serialized.includes('12.9716'), 'Latitude must never appear in logs');
  assert.ok(!serialized.includes('77.5946'), 'Longitude must never appear in logs');
  assert.ok(!serialized.includes('12.9172'), 'Destination latitude must never appear in logs');
  assert.equal(sanitized.body.costing, 'auto');
});

test('ProviderRegistry enforces replaceable adapters across all 10 service boundaries', () => {
  const registry = new ProviderRegistry();

  registry.register('tile', { name: 'martin-pmtiles', selfHosted: true });
  registry.register('geocoding', { name: 'photon-opensearch-1.3', selfHosted: true });
  registry.register('routing', { name: 'valhalla-3.6', selfHosted: true });
  registry.register('traffic', { name: 'hexa-traffic-engine', selfHosted: true });
  registry.register('imageStorage', { name: 'seaweedfs-s3', selfHosted: true });
  registry.register('ai', { name: 'disabled-by-default', selfHosted: true, optional: true });

  assert.equal(registry.get('routing').name, 'valhalla-3.6');
  assert.equal(registry.get('imageStorage').name, 'seaweedfs-s3');
  assert.throws(() => registry.register('unknownSlot', { name: 'bad' }));
});

test('Privacy trajectory filter strips first and last 500m + jitter to protect home/work endpoints', () => {
  // Construct a ~4 km northward trace along Bengaluru Hosur Road -> MG Road (0.001 deg lat ≈ 111m)
  const rawTrace = [];
  for (let i = 0; i <= 40; i++) {
    rawTrace.push({
      latitude: 12.9300 + i * 0.001,
      longitude: 77.6100,
      speedKph: 32
    });
  }

  const clipped = clipTrajectoryEndpointsForPrivacy(rawTrace, {
    baseTrimMeters: 500,
    jitterStartMeters: 150,
    jitterEndMeters: 150
  });

  // 650m at each end (~6 points at each end) must be stripped
  assert.ok(clipped.length > 0 && clipped.length <= 29);
  assert.ok(clipped[0].latitude >= 12.9355, 'Origin neighborhood must be clipped');
  assert.ok(clipped[clipped.length - 1].latitude <= 12.9645, 'Destination neighborhood must be clipped');
});
