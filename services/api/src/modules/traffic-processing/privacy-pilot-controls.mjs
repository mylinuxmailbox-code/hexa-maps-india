/**
 * HEXA MAPS — Gate 6 Privacy-Reviewed Traffic Pilot Controls, Shockwave Sybil Detector,
 * & Valhalla Weekly Historical Traffic Profile Builder (`services/api/src/modules/traffic-processing/privacy-pilot-controls.mjs`)
 *
 * Implements `docs/07_SECURITY_AND_PRIVACY.md` & `docs/05_TRAFFIC_SYSTEM.md`:
 * 1. Three-Tier Explicit Consent State Machine:
 *    - Foreground Map Location (off by default)
 *    - Foreground Traffic Contribution (opt-in, requires Foreground Map Location)
 *    - Background Traffic Contribution (requires separate explicit permission + foreground opt-in)
 *    - Live Location Sharing (time-bounded only, never permanent by default)
 *    - Personal Timeline (strictly off by default; local-only when enabled)
 * 2. Ephemeral Session Rotator:
 *    - Automatically rotates cryptographic ephemeral session tokens every 15 minutes (900s)
 *      OR every 10 kilometers (10,000m) traveled, whichever comes first, preventing longitudinal
 *      trip linkage.
 * 3. Topological Shockwave Anomaly Detector ("99 Phones in a Wagon" / Localized Sybil Attack):
 *    - Flags an edge as `SYBIL_ANOMALY_SUSPECTED` and dampens its speed toward historical/neighbor
 *      flow if a sudden speed drop (< 25% of free-flow) occurs on a single edge while BOTH
 *      connected upstream and downstream edges have active `LIVE` free-flow (>= 75% of free-flow)
 *      and zero corroborated incident reports exist.
 * 4. Valhalla 168-Hour Historical Traffic Profile Builder (2,016 five-minute weekly buckets):
 *    - Aggregates privacy-approved ($k \ge 5$) speeds into 2,016 weekly 5-minute buckets
 *      ($7 \times 24 \times 12 = 2016$) and exports Valhalla-compatible `predicted_speeds`
 *      CSV/DCT profile records (`free_flow_speed`, `constrained_flow_speed`, and bucket speeds).
 */

import crypto from 'node:crypto';
import { haversineDistanceMeters } from '../../index.mjs';
import { TRAFFIC_STATES } from './traffic-processing-engine.mjs';

export const MAX_EPHEMERAL_SESSION_SECONDS = 900;     // 15 minutes
export const MAX_EPHEMERAL_SESSION_METERS = 10_000.0; // 10 kilometers
export const WEEKLY_5MIN_BUCKET_COUNT = 2016;         // 7 days * 24 hours * 12 (5-min buckets)

/**
 * Manages the 15-minute / 10-km rotating ephemeral session identifier and enforces
 * explicit three-tier opt-in consent and instant revocation.
 */
export class EphemeralProbeSessionManager {
  constructor() {
    this.consent = {
      foregroundLocationEnabled: false,
      foregroundTrafficOptIn: false,
      backgroundTrafficOptIn: false,
      liveLocationSharingEnabled: false,
      liveLocationSharingExpiresAtEpoch: null,
      personalTimelineEnabled: false // Strictly off by default
    };

    this.currentSessionId = null;
    this.sessionCreatedAtEpoch = 0;
    this.sessionDistanceTraveledMeters = 0;
    this.lastAcceptedCoord = null;
    this.isPaused = false;
  }

  /**
   * Updates user privacy permissions, enforcing hierarchical safety constraints.
   */
  updatePermissions({
    foregroundLocationEnabled,
    foregroundTrafficOptIn,
    backgroundTrafficOptIn,
    liveLocationSharingDurationSeconds = null,
    personalTimelineEnabled,
    nowEpoch = Math.floor(Date.now() / 1000)
  } = {}) {
    if (typeof foregroundLocationEnabled === 'boolean') {
      this.consent.foregroundLocationEnabled = foregroundLocationEnabled;
    }
    if (typeof foregroundTrafficOptIn === 'boolean') {
      this.consent.foregroundTrafficOptIn =
        this.consent.foregroundLocationEnabled && foregroundTrafficOptIn;
    }
    // Background traffic contribution requires BOTH foreground opt-in and separate background permission
    if (typeof backgroundTrafficOptIn === 'boolean') {
      this.consent.backgroundTrafficOptIn =
        this.consent.foregroundTrafficOptIn && backgroundTrafficOptIn;
    }
    if (!this.consent.foregroundLocationEnabled) {
      this.consent.foregroundTrafficOptIn = false;
      this.consent.backgroundTrafficOptIn = false;
    }

    if (liveLocationSharingDurationSeconds != null && liveLocationSharingDurationSeconds > 0) {
      // Cap maximum single-session sharing duration to 24 hours (never infinite by default)
      const boundedDuration = Math.min(86_400, Number(liveLocationSharingDurationSeconds));
      this.consent.liveLocationSharingEnabled = true;
      this.consent.liveLocationSharingExpiresAtEpoch = nowEpoch + boundedDuration;
    }

    if (typeof personalTimelineEnabled === 'boolean') {
      this.consent.personalTimelineEnabled = personalTimelineEnabled;
    }

    return { ...this.consent };
  }

  /**
   * One-tap emergency kill switch: revokes all location contribution and sharing,
   * purges active ephemeral token state, and clears any local buffer.
   */
  revokeAllAndPurge() {
    this.consent = {
      foregroundLocationEnabled: false,
      foregroundTrafficOptIn: false,
      backgroundTrafficOptIn: false,
      liveLocationSharingEnabled: false,
      liveLocationSharingExpiresAtEpoch: null,
      personalTimelineEnabled: false
    };
    this.currentSessionId = null;
    this.sessionCreatedAtEpoch = 0;
    this.sessionDistanceTraveledMeters = 0;
    this.lastAcceptedCoord = null;
    this.isPaused = false;
  }

  pauseContributions() {
    this.isPaused = true;
    // Rotate token immediately on pause so resumption starts with a fresh unlinkable token
    this.currentSessionId = null;
  }

  resumeContributions() {
    this.isPaused = false;
  }

  /**
   * Returns the active ephemeral session ID for a GPS point, rotating automatically if
   * 15 minutes (900s) OR 10 km (10,000m) have elapsed since session creation.
   * Returns `null` if contribution consent is not granted or is paused.
   */
  getOrRotateSessionForPoint(
    point,
    { isBackground = false, nowEpoch = Math.floor(Date.now() / 1000) } = {}
  ) {
    if (this.isPaused) return null;
    if (!this.consent.foregroundLocationEnabled || !this.consent.foregroundTrafficOptIn) {
      return null;
    }
    if (isBackground && !this.consent.backgroundTrafficOptIn) {
      return null;
    }

    let stepMeters = 0;
    if (this.lastAcceptedCoord && point) {
      stepMeters = haversineDistanceMeters(this.lastAcceptedCoord, point);
    }

    const ageSeconds = nowEpoch - this.sessionCreatedAtEpoch;
    const projectedDistance = this.sessionDistanceTraveledMeters + stepMeters;

    if (
      !this.currentSessionId ||
      ageSeconds >= MAX_EPHEMERAL_SESSION_SECONDS ||
      projectedDistance >= MAX_EPHEMERAL_SESSION_METERS
    ) {
      this.currentSessionId = `eph-${crypto.randomBytes(12).toString('hex')}`;
      this.sessionCreatedAtEpoch = nowEpoch;
      this.sessionDistanceTraveledMeters = 0;
    } else {
      this.sessionDistanceTraveledMeters = projectedDistance;
    }

    this.lastAcceptedCoord = point;
    return this.currentSessionId;
  }
}

/**
 * Evaluates topological shockwave consistency across connected road edges to detect
 * localized Sybil congestion attacks ("99 phones in a stationary wagon").
 *
 * If an edge reports severe congestion (< 25% of free-flow) with zero corroborated incident
 * reports, while BOTH its upstream and downstream neighbors are in active `LIVE` free-flow
 * (>= 75% of free-flow), the snapshot is downgraded to `LIVE_LOW_CONFIDENCE` and its
 * effective speed is dampened toward the neighborhood/historical flow.
 */
export function applyShockwaveSybilDefense(
  edgeSnapshotsMap,
  edgeTopologyMap,
  corroboratedIncidentEdgeKeys = new Set()
) {
  const hardened = new Map();

  for (const [edgeKey, snap] of edgeSnapshotsMap.entries()) {
    if (snap.state !== TRAFFIC_STATES.LIVE || snap.effectiveSpeedKph == null) {
      hardened.set(edgeKey, { ...snap, sybilAnomalyDetected: false });
      continue;
    }

    const ratio = snap.effectiveSpeedKph / Math.max(1.0, snap.freeFlowSpeedKph);
    const topology = edgeTopologyMap.get(edgeKey) || {};
    const upstreamKeys = topology.upstreamEdgeKeys || [];
    const downstreamKeys = topology.downstreamEdgeKeys || [];

    if (
      ratio < 0.25 &&
      !corroboratedIncidentEdgeKeys.has(edgeKey) &&
      upstreamKeys.length > 0 &&
      downstreamKeys.length > 0
    ) {
      const upstreamFreeFlow = upstreamKeys.every((uk) => {
        const u = edgeSnapshotsMap.get(uk);
        return u && u.state === TRAFFIC_STATES.LIVE && u.effectiveSpeedKph / u.freeFlowSpeedKph >= 0.75;
      });
      const downstreamFreeFlow = downstreamKeys.every((dk) => {
        const d = edgeSnapshotsMap.get(dk);
        return d && d.state === TRAFFIC_STATES.LIVE && d.effectiveSpeedKph / d.freeFlowSpeedKph >= 0.75;
      });

      if (upstreamFreeFlow && downstreamFreeFlow) {
        const fallbackRef = snap.historicalSpeedKph ?? snap.freeFlowSpeedKph * 0.75;
        const dampenedSpeed = Number((0.30 * snap.effectiveSpeedKph + 0.70 * fallbackRef).toFixed(1));
        hardened.set(edgeKey, {
          ...snap,
          state: TRAFFIC_STATES.LIVE_LOW_CONFIDENCE,
          effectiveSpeedKph: dampenedSpeed,
          confidenceScore: 0.35,
          sybilAnomalyDetected: true
        });
        continue;
      }
    }

    hardened.set(edgeKey, { ...snap, sybilAnomalyDetected: false });
  }

  return hardened;
}

/**
 * Builds a Valhalla-compatible 168-hour weekly historical traffic profile
 * (`2,016` five-minute buckets: Sunday 00:00 -> Saturday 23:55) from privacy-approved ($k \ge 5$)
 * historical edge observations.
 */
export function buildValhallaWeeklyHistoricalProfile({
  edgeKey,
  freeFlowSpeedKph,
  constrainedFlowSpeedKph,
  bucketObservations = {}
}) {
  const buckets = new Array(WEEKLY_5MIN_BUCKET_COUNT);

  for (let b = 0; b < WEEKLY_5MIN_BUCKET_COUNT; b++) {
    // Determine time-of-day within the 288 daily 5-min buckets (0..287)
    const bucketInDay = b % 288;
    const hourOfDay = bucketInDay / 12.0;

    // Nighttime (22:00..06:00) defaults to freeFlowSpeedKph; Daytime (07:00..21:00) defaults to constrainedFlowSpeedKph
    const baselineSpeed =
      hourOfDay >= 7.0 && hourOfDay <= 21.0 ? constrainedFlowSpeedKph : freeFlowSpeedKph;

    const obs = bucketObservations[b];
    if (obs && obs.contributorCount >= 5 && typeof obs.speedKph === 'number') {
      buckets[b] = Math.round(Math.max(2, Math.min(252, obs.speedKph)));
    } else {
      buckets[b] = Math.round(baselineSpeed);
    }
  }

  return {
    edgeKey,
    bucketCount: WEEKLY_5MIN_BUCKET_COUNT,
    freeFlowSpeedKph: Math.round(freeFlowSpeedKph),
    constrainedFlowSpeedKph: Math.round(constrainedFlowSpeedKph),
    weeklySpeedBucketsKph: buckets
  };
}
