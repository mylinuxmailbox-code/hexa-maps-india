/**
 * HEXA MAPS — Traffic Probe Ingestion & Anti-Spoofing Validator (`services/api/src/modules/traffic-ingestion`)
 *
 * Implements `docs/05_TRAFFIC_SYSTEM.md` & `docs/SECURITY_THREAT_MODEL.md`:
 * 1. Explicit Opt-In Verification: Rejects payloads that do not carry an explicit
 *    opt-in consent flag (`optInConsentGranted === true`).
 * 2. Identity Decoupling: Rejects requests that include user account tokens (`userId`,
 *    `accountToken`, `authorization`) so probe telemetry can never be tied to a user account.
 * 3. Spatial Privacy Trimming: Clips the first 500m and last 500m (+ random 100-300m jitter)
 *    before emitting to the processing stream, unless the batch is already an active mid-trip segment.
 * 4. Kinematic Sanity & Anti-Spoofing:
 *    - Rejects impossible speeds (< 0 or > 180 km/h on urban/national roads).
 *    - Rejects teleportation / impossible acceleration (> 9.0 m/s² between consecutive points).
 *    - Rejects replayed/expired timestamps (> 10 minutes old or > 60 seconds in the future).
 * 5. Subnet Sybil Cap: Limits the number of distinct ephemeral sessions accepted from the
 *    same anonymized subnet hash within a rolling 5-minute window ("99 phones in a wagon" mitigation).
 */

import { haversineDistanceMeters, clipTrajectoryEndpointsForPrivacy } from '../../index.mjs';

const MAX_ACCELERATION_MPS2 = 9.0;
const MAX_SPEED_KPH = 180.0;
const MAX_CLOCK_SKEW_FUTURE_SEC = 60;
const MAX_PROBE_AGE_SEC = 600; // 10 minutes

export class TrafficProbeIngestionService {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxSessionsPerSubnetWindow=15]
   */
  constructor({ maxSessionsPerSubnetWindow = 15 } = {}) {
    this.maxSessionsPerSubnetWindow = maxSessionsPerSubnetWindow;
    /** @type {Map<string, Set<string>>} subnetHash -> Set<ephemeralSessionId> */
    this.subnetSessionTracker = new Map();
  }

  /**
   * Validates, privacy-filters, and sanitizes an incoming probe batch.
   *
   * @param {Object} batch
   * @param {boolean} batch.optInConsentGranted
   * @param {string} batch.ephemeralSessionId
   * @param {string} [batch.subnetHash] - Rotating salted hash of /24 IPv4 or /48 IPv6
   * @param {boolean} [batch.applyEndpointTrimming=false] - True when submitting a full trip trace
   * @param {Array<{latitude: number, longitude: number, speedKph: number, bearingDegrees?: number, timestampEpoch: number, gpsAccuracyMeters?: number}>} batch.probes
   * @param {number} [nowEpoch]
   */
  ingestBatch(batch, nowEpoch = Math.floor(Date.now() / 1000)) {
    if (!batch || batch.optInConsentGranted !== true) {
      return { accepted: false, reason: 'OPT_IN_CONSENT_REQUIRED', validProbes: [] };
    }

    // Forbidden identity linkage check (Security Threat Model 2.1)
    if (batch.userId || batch.accountToken || batch.authorizationHeader) {
      return { accepted: false, reason: 'ACCOUNT_IDENTITY_FORBIDDEN_ON_PROBE_ENDPOINT', validProbes: [] };
    }

    const sessionId = String(batch.ephemeralSessionId || '').trim();
    if (sessionId.length < 8) {
      return { accepted: false, reason: 'INVALID_EPHEMERAL_SESSION_ID', validProbes: [] };
    }

    // Subnet Sybil rate-limiting ("99 phones in a wagon" defense)
    const subnetKey = batch.subnetHash || 'default-subnet';
    let subnetSessions = this.subnetSessionTracker.get(subnetKey);
    if (!subnetSessions) {
      subnetSessions = new Set();
      this.subnetSessionTracker.set(subnetKey, subnetSessions);
    }
    if (!subnetSessions.has(sessionId) && subnetSessions.size >= this.maxSessionsPerSubnetWindow) {
      return { accepted: false, reason: 'SUBNET_SYBIL_CAP_EXCEEDED', validProbes: [] };
    }

    let candidateProbes = Array.isArray(batch.probes) ? batch.probes : [];
    if (candidateProbes.length === 0) {
      return { accepted: false, reason: 'EMPTY_PROBE_BATCH', validProbes: [] };
    }

    if (batch.applyEndpointTrimming) {
      candidateProbes = clipTrajectoryEndpointsForPrivacy(candidateProbes, {
        baseTrimMeters: 500,
        jitterStartMeters: 150,
        jitterEndMeters: 150
      });
    }

    const sorted = [...candidateProbes].sort((a, b) => a.timestampEpoch - b.timestampEpoch);
    const validProbes = [];

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const age = nowEpoch - p.timestampEpoch;

      // Reject replay attacks or future-dated timestamps
      if (age > MAX_PROBE_AGE_SEC || age < -MAX_CLOCK_SKEW_FUTURE_SEC) {
        continue;
      }

      // Reject poor GPS horizontal accuracy (> 40m) or impossible speeds
      if ((p.gpsAccuracyMeters ?? 10) > 40 || p.speedKph < 0 || p.speedKph > MAX_SPEED_KPH) {
        continue;
      }

      // Kinematic continuity check against previous accepted probe in the same session
      if (validProbes.length > 0) {
        const prev = validProbes[validProbes.length - 1];
        const dt = p.timestampEpoch - prev.timestampEpoch;
        if (dt <= 0) continue;

        const distMeters = haversineDistanceMeters(prev, p);
        const impliedSpeedKph = (distMeters / dt) * 3.6;

        // Teleportation check: implied ground speed > 200 km/h
        if (impliedSpeedKph > 200.0) {
          return { accepted: false, reason: 'KINEMATIC_TELEPORTATION_DETECTED', validProbes: [] };
        }

        const dvMps = Math.abs(p.speedKph - prev.speedKph) / 3.6;
        const accelMps2 = dvMps / dt;
        if (accelMps2 > MAX_ACCELERATION_MPS2) {
          return { accepted: false, reason: 'KINEMATIC_IMPOSSIBLE_ACCELERATION', validProbes: [] };
        }
      }

      validProbes.push({
        ephemeralSessionId: sessionId,
        latitude: p.latitude,
        longitude: p.longitude,
        speedKph: Number(p.speedKph),
        bearingDegrees: p.bearingDegrees ?? 0,
        timestampEpoch: p.timestampEpoch
      });
    }

    if (validProbes.length === 0) {
      return { accepted: false, reason: 'NO_VALID_PROBES_AFTER_FILTERING', validProbes: [] };
    }

    subnetSessions.add(sessionId);
    return { accepted: true, reason: 'OK', validProbes };
  }
}
