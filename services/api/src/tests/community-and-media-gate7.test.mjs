import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  INCIDENT_TYPES,
  INCIDENT_VERIFICATION_STATE,
  CommunityIncidentService
} from '../modules/contributions/incident-corroboration-service.mjs';
import { LocationSharingService } from '../modules/location-sharing/location-sharing-service.mjs';
import {
  stripJpegExifAndComments,
  normalizePanoramaxFeature
} from '../modules/media/media-privacy-and-panoramax.mjs';

test('Community incident corroboration prevents single-user fake road closures from blocking routing until corroborated', () => {
  const service = new CommunityIncidentService();
  const now = 1794550000;
  const silkBoardCoord = { latitude: 12.9172, longitude: 77.6228 };

  // 1. Single unverified user submits a ROAD_CLOSURE -> advisory only, does NOT affect routing closure
  const report1 = service.submitIncidentReport({
    reporterId: 'user-1',
    type: INCIDENT_TYPES.ROAD_CLOSURE,
    coordinate: silkBoardCoord,
    directedEdgeKey: '0:2401:10',
    description: 'Flyover closed for maintenance',
    nowEpoch: now
  });
  assert.equal(report1.verificationState, INCIDENT_VERIFICATION_STATE.UNVERIFIED_ADVISORY);
  assert.equal(report1.affectsRoutingClosure, false);

  // 2. Same user submitting twice does NOT increase distinct reporter count
  const reportDuplicate = service.submitIncidentReport({
    reporterId: 'user-1',
    type: INCIDENT_TYPES.ROAD_CLOSURE,
    coordinate: silkBoardCoord,
    nowEpoch: now + 10
  });
  assert.equal(reportDuplicate.reporterCount, 1);
  assert.equal(reportDuplicate.affectsRoutingClosure, false);

  // 3. Second and third distinct contributors within 100m corroborate the closure -> becomes CORROBORATED_ACTIVE
  service.submitIncidentReport({
    reporterId: 'user-2',
    type: INCIDENT_TYPES.ROAD_CLOSURE,
    coordinate: { latitude: 12.9173, longitude: 77.6229 },
    nowEpoch: now + 30
  });
  const report3 = service.submitIncidentReport({
    reporterId: 'user-3',
    type: INCIDENT_TYPES.ROAD_CLOSURE,
    coordinate: { latitude: 12.9171, longitude: 77.6227 },
    nowEpoch: now + 45
  });

  assert.equal(report3.reporterCount, 3);
  assert.equal(report3.verificationState, INCIDENT_VERIFICATION_STATE.CORROBORATED_ACTIVE);
  assert.equal(report3.affectsRoutingClosure, true);
});

test('LocationSharingService enforces time-bounded E2EE ciphertext relay, forbids plaintext coordinates, and supports instant revocation', () => {
  const sharing = new LocationSharingService();
  const now = 1794550000;

  // 1. Rejects > 24h permanent sharing sessions
  assert.throws(() => sharing.createShareSession({ durationSeconds: 90_000, nowEpoch: now }));

  // 2. Creates a 1-hour session
  const session = sharing.createShareSession({ durationSeconds: 3600, nowEpoch: now });
  const secretKey = crypto.randomBytes(32);

  // 3. Rejects plaintext coordinates on the server relay endpoint
  assert.throws(() =>
    sharing.publishEncryptedLocationUpdate({
      sessionId: session.sessionId,
      writeToken: session.writeToken,
      encryptedPayload: { latitude: 12.9716, longitude: 77.5946 },
      nowEpoch: now + 5
    })
  );

  // 4. Accepts AES-256-GCM E2EE payload and roundtrips cleanly on recipient client
  const originalCoord = { latitude: 12.9716, longitude: 77.5946, speedKph: 34 };
  const encrypted = LocationSharingService.encryptCoordinateClientSide(originalCoord, secretKey);

  sharing.publishEncryptedLocationUpdate({
    sessionId: session.sessionId,
    writeToken: session.writeToken,
    encryptedPayload: encrypted,
    nowEpoch: now + 10
  });

  const relayed = sharing.readEncryptedLocationUpdate(session.sessionId, now + 15);
  assert.ok(relayed && relayed.encryptedPayload);
  assert.ok(!JSON.stringify(relayed).includes('12.9716'));

  const decrypted = LocationSharingService.decryptCoordinateClientSide(
    relayed.encryptedPayload,
    secretKey
  );
  assert.deepEqual(decrypted, originalCoord);

  // 5. Instant revocation purges session immediately
  assert.equal(sharing.revokeSession(session.sessionId, session.writeToken), true);
  assert.equal(sharing.readEncryptedLocationUpdate(session.sessionId, now + 20), null);
});

test('JPEG EXIF scrubber removes APP1 GPS/device metadata and Panoramax adapter verifies per-image open licence', () => {
  // Construct a synthetic JPEG with SOI (FFD8), APP1 EXIF segment (FFE1) containing secret GPS text, DQT (FFDB), and EOI (FFD9)
  const exifPayload = Buffer.from('Exif\0\0SECRET_HOME_GPS_12.9716_SERIAL_99999', 'utf8');
  const app1Len = Buffer.alloc(2);
  app1Len.writeUInt16BE(exifPayload.length + 2, 0);

  const dqtPayload = Buffer.from([0x00, 0x01, 0x02, 0x03]);
  const dqtLen = Buffer.alloc(2);
  dqtLen.writeUInt16BE(dqtPayload.length + 2, 0);

  const rawJpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xe1]), // APP1 (EXIF)
    app1Len,
    exifPayload,
    Buffer.from([0xff, 0xdb]), // DQT
    dqtLen,
    dqtPayload,
    Buffer.from([0xff, 0xd9])  // EOI
  ]);

  const scrubbed = stripJpegExifAndComments(rawJpeg);
  assert.ok(!scrubbed.toString('utf8').includes('SECRET_HOME_GPS'));
  assert.equal(scrubbed[0], 0xff);
  assert.equal(scrubbed[1], 0xd8);
  assert.equal(scrubbed[scrubbed.length - 2], 0xff);
  assert.equal(scrubbed[scrubbed.length - 1], 0xd9);

  // Panoramax license check: accepts CC-BY-SA-4.0, rejects restricted/unknown license
  const validStac = {
    id: 'pic-blr-mg-road-01',
    geometry: { type: 'Point', coordinates: [77.6066, 12.9756] },
    properties: {
      license: 'CC-BY-SA-4.0',
      'view:azimuth': 90,
      'geovisio:producer': 'Namma OSM Mapper',
      datetime: '2026-11-10T09:00:00Z'
    },
    assets: {
      sd: { href: 'https://panoramax.example.org/sd/01.jpg' }
    }
  };
  const normalizedPic = normalizePanoramaxFeature(validStac);
  assert.equal(normalizedPic.attribution.license, 'CC-BY-SA-4.0');
  assert.ok(normalizedPic.attribution.requiredNotice.includes('Namma OSM Mapper'));

  const unlicensedStac = {
    ...validStac,
    properties: { ...validStac.properties, license: 'PROPRIETARY-ALL-RIGHTS-RESERVED' }
  };
  assert.equal(normalizePanoramaxFeature(unlicensedStac), null);
});
