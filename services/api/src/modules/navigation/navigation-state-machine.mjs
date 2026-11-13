/**
 * HEXA MAPS — Turn-by-Turn Navigation & Rerouting Engine (`services/api/src/modules/navigation`)
 *
 * Implements `docs/01_PRODUCT_REQUIREMENTS.md` Section 6:
 * - Active route tracking, upcoming maneuver, distance to maneuver, remaining distance/duration,
 *   ETA, current speed, speed limit, route deviation detection, automatic rerouting trigger,
 *   and arrival detection.
 * - Cross-platform deterministic math shared conceptually with `HexaNavigationController.swift` on macOS/iOS.
 */

import { haversineDistanceMeters } from '../../index.mjs';

export const NAVIGATION_STATUS = Object.freeze({
  IDLE: 'IDLE',
  ACTIVE: 'ACTIVE',
  REROUTING: 'REROUTING',
  PAUSED: 'PAUSED',
  ARRIVED: 'ARRIVED'
});

const OFF_ROUTE_DISTANCE_METERS = 45.0;
const OFF_ROUTE_CONSECUTIVE_FIXES_REQUIRED = 2;
const ARRIVAL_RADIUS_METERS = 30.0;

/**
 * Computes minimum distance in meters from a point `p` to a 2D line segment `a -> b`,
 * along with the fractional projection `t` in [0, 1].
 */
export function pointToSegmentDistanceMeters(p, a, b) {
  const cosLat = Math.cos((p.latitude * Math.PI) / 180.0);
  const metersPerDegLat = 111132.0;
  const metersPerDegLon = 111320.0 * cosLat;

  const ax = (a.longitude - p.longitude) * metersPerDegLon;
  const ay = (a.latitude - p.latitude) * metersPerDegLat;
  const bx = (b.longitude - p.longitude) * metersPerDegLon;
  const by = (b.latitude - p.latitude) * metersPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  let t = 0.0;
  if (lenSq > 1e-6) {
    t = Math.max(0.0, Math.min(1.0, -(ax * dx + ay * dy) / lenSq));
  }

  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const distanceMeters = Math.sqrt(projX * projX + projY * projY);

  return { distanceMeters, t };
}

export class NavigationSessionTracker {
  constructor(route) {
    if (!route || !Array.isArray(route.geometry2D) || route.geometry2D.length < 2) {
      throw new Error('Valid 2D route with at least 2 geometry points is required');
    }
    this.route = route;
    this.status = NAVIGATION_STATUS.ACTIVE;
    this.currentManeuverIndex = 0;
    this.consecutiveOffRouteFixes = 0;
    this.spokenAnnouncements = new Set();
  }

  /**
   * Evaluates a new GPS fix `{ latitude, longitude, speedKph, bearingDegrees, speedLimitKph }`
   * and returns the updated turn-by-turn HUD state.
   */
  updateLocationFix(fix) {
    if (this.status === NAVIGATION_STATUS.PAUSED || this.status === NAVIGATION_STATUS.ARRIVED) {
      return this.#snapshot(fix, 0, null);
    }

    const geom = this.route.geometry2D;
    const destination = geom[geom.length - 1];
    const distToDestination = haversineDistanceMeters(fix, destination);

    // 1. Check Arrival
    if (distToDestination <= ARRIVAL_RADIUS_METERS) {
      this.status = NAVIGATION_STATUS.ARRIVED;
      return this.#snapshot(fix, 0, 'You have arrived at your destination.');
    }

    // 2. Snap to nearest route polyline segment
    let minCrossTrackMeters = Infinity;
    let closestVertexIndex = 0;

    for (let i = 0; i < geom.length - 1; i++) {
      const { distanceMeters } = pointToSegmentDistanceMeters(fix, geom[i], geom[i + 1]);
      if (distanceMeters < minCrossTrackMeters) {
        minCrossTrackMeters = distanceMeters;
        closestVertexIndex = i;
      }
    }

    // 3. Check Off-Route Deviation (requires 2 consecutive fixes > 45m to avoid single GPS glitch reroutes)
    if (minCrossTrackMeters > OFF_ROUTE_DISTANCE_METERS) {
      this.consecutiveOffRouteFixes += 1;
      if (this.consecutiveOffRouteFixes >= OFF_ROUTE_CONSECUTIVE_FIXES_REQUIRED) {
        this.status = NAVIGATION_STATUS.REROUTING;
        return this.#snapshot(fix, Math.round(distToDestination), 'Recalculating route.');
      }
    } else {
      this.consecutiveOffRouteFixes = 0;
      this.status = NAVIGATION_STATUS.ACTIVE;
    }

    // 4. Advance maneuver index based on snapped vertex index
    const maneuvers = this.route.maneuvers || [];
    for (let mIdx = this.currentManeuverIndex; mIdx < maneuvers.length; mIdx++) {
      const m = maneuvers[mIdx];
      if (closestVertexIndex >= (m.beginShapeIndex ?? 0)) {
        this.currentManeuverIndex = Math.min(maneuvers.length - 1, mIdx + 1);
      }
    }

    const nextManeuver = maneuvers[this.currentManeuverIndex] || maneuvers[maneuvers.length - 1] || null;
    const maneuverTargetCoord =
      nextManeuver && geom[nextManeuver.beginShapeIndex]
        ? geom[nextManeuver.beginShapeIndex]
        : destination;

    const distanceToNextManeuverMeters = Math.round(
      haversineDistanceMeters(fix, maneuverTargetCoord)
    );

    // 5. Voice Guidance Trigger (500m pre-transition & 60m final transition, spoken once per threshold)
    let voicePrompt = null;
    if (nextManeuver) {
      const key500 = `${this.currentManeuverIndex}:500`;
      const key60 = `${this.currentManeuverIndex}:60`;

      if (distanceToNextManeuverMeters <= 60 && !this.spokenAnnouncements.has(key60)) {
        this.spokenAnnouncements.add(key60);
        voicePrompt = nextManeuver.verbalPreTransitionInstruction || nextManeuver.instruction;
      } else if (
        distanceToNextManeuverMeters <= 500 &&
        distanceToNextManeuverMeters > 60 &&
        !this.spokenAnnouncements.has(key500)
      ) {
        this.spokenAnnouncements.add(key500);
        voicePrompt = `In ${distanceToNextManeuverMeters} meters, ${nextManeuver.instruction}`;
      }
    }

    return this.#snapshot(fix, distanceToNextManeuverMeters, voicePrompt);
  }

  pause() {
    this.status = NAVIGATION_STATUS.PAUSED;
  }

  resume() {
    if (this.status === NAVIGATION_STATUS.PAUSED) {
      this.status = NAVIGATION_STATUS.ACTIVE;
    }
  }

  #snapshot(fix, distanceToManeuverMeters, voicePrompt) {
    const geom = this.route.geometry2D;
    const destination = geom[geom.length - 1];
    const remainingDistanceMeters = Math.round(haversineDistanceMeters(fix, destination));
    const speedMps = Math.max(2.5, Number(fix.speedKph || 30) / 3.6);
    const remainingDurationSeconds =
      this.status === NAVIGATION_STATUS.ARRIVED
        ? 0
        : Math.round(remainingDistanceMeters / speedMps);

    const maneuvers = this.route.maneuvers || [];
    const upcomingManeuver = maneuvers[this.currentManeuverIndex] || null;

    return {
      status: this.status,
      currentSpeedKph: Math.round(Number(fix.speedKph || 0)),
      speedLimitKph: fix.speedLimitKph ?? null,
      isOverSpeedLimit:
        fix.speedLimitKph != null && Number(fix.speedKph || 0) > Number(fix.speedLimitKph) + 3,
      upcomingManeuver,
      distanceToManeuverMeters,
      remainingDistanceMeters,
      remainingDurationSeconds,
      voiceAnnouncement: voicePrompt,
      shouldTriggerReroute: this.status === NAVIGATION_STATUS.REROUTING
    };
  }
}
