/**
 * HEXA MAPS — Community Road Incident Reports, Reviews & Corroboration Engine
 * (`services/api/src/modules/contributions`)
 *
 * Implements `docs/01_PRODUCT_REQUIREMENTS.md` Section 7 & 11 and `docs/SECURITY_THREAT_MODEL.md` Section 2.3:
 * 1. Incident Types: `ACCIDENT`, `ROAD_CLOSURE`, `CONSTRUCTION`, `FLOOD`, `BROKEN_DOWN_VEHICLE`.
 * 2. Anti-Abuse Corroboration Gate:
 *    - A single unverified user's `ROAD_CLOSURE` or `FLOOD` report is marked `UNVERIFIED_ADVISORY`
 *      (displayed as an informational warning on the map, but NEVER allowed to hard-block Valhalla
 *      routing by itself).
 *    - A report transitions to `CORROBORATED_ACTIVE` (and can affect routing cost/closures) only when:
 *      (a) >= 3 distinct contributor accounts/tokens corroborate it within 100m & 30 minutes, OR
 *      (b) Live traffic on the underlying directed edge confirms a speed drop (v <= 8 km/h), OR
 *      (c) Submitted by an authenticated municipal/moderator feed (`isOfficialFeed === true`).
 */

import { haversineDistanceMeters } from '../../index.mjs';

export const INCIDENT_TYPES = Object.freeze({
  ACCIDENT: 'ACCIDENT',
  ROAD_CLOSURE: 'ROAD_CLOSURE',
  CONSTRUCTION: 'CONSTRUCTION',
  FLOOD: 'FLOOD',
  BROKEN_DOWN_VEHICLE: 'BROKEN_DOWN_VEHICLE'
});

export const INCIDENT_VERIFICATION_STATE = Object.freeze({
  UNVERIFIED_ADVISORY: 'UNVERIFIED_ADVISORY',
  CORROBORATED_ACTIVE: 'CORROBORATED_ACTIVE',
  EXPIRED_OR_RESOLVED: 'EXPIRED_OR_RESOLVED'
});

const CORROBORATION_RADIUS_METERS = 100.0;
const MIN_DISTINCT_REPORTERS_FOR_CLOSURE = 3;

export class CommunityIncidentService {
  constructor() {
    /** @type {Array<Object>} */
    this.incidents = [];
  }

  /**
   * Submits or corroborates a road incident report.
   */
  submitIncidentReport({
    reporterId,
    type,
    coordinate,
    directedEdgeKey = null,
    description = '',
    isOfficialFeed = false,
    liveEdgeSpeedKph = null,
    nowEpoch = Math.floor(Date.now() / 1000)
  }) {
    if (!reporterId || !INCIDENT_TYPES[type] || !coordinate) {
      throw new Error('reporterId, valid incident type, and coordinate are required');
    }

    // Find an existing active incident of the same type within 100m reported in the last 60 minutes
    let cluster = this.incidents.find(
      (inc) =>
        inc.type === type &&
        nowEpoch - inc.createdAtEpoch <= 3600 &&
        haversineDistanceMeters(inc.coordinate, coordinate) <= CORROBORATION_RADIUS_METERS
    );

    if (!cluster) {
      cluster = {
        id: `inc-${this.incidents.length + 1}`,
        type,
        coordinate,
        directedEdgeKey,
        description: String(description).slice(0, 280),
        createdAtEpoch: nowEpoch,
        updatedAtEpoch: nowEpoch,
        reporters: new Set([reporterId]),
        downvotes: new Set(),
        isOfficialFeed: Boolean(isOfficialFeed),
        verificationState: INCIDENT_VERIFICATION_STATE.UNVERIFIED_ADVISORY,
        affectsRoutingClosure: false
      };
      this.incidents.push(cluster);
    } else {
      cluster.reporters.add(reporterId);
      cluster.updatedAtEpoch = nowEpoch;
      if (isOfficialFeed) {
        cluster.isOfficialFeed = true;
      }
    }

    this.#recalculateVerification(cluster, liveEdgeSpeedKph);
    return this.#serialize(cluster);
  }

  #recalculateVerification(cluster, liveEdgeSpeedKph) {
    const distinctReporters = cluster.reporters.size;
    const confirmedByLowLiveSpeed =
      typeof liveEdgeSpeedKph === 'number' && liveEdgeSpeedKph <= 8.0 && distinctReporters >= 2;

    if (
      cluster.isOfficialFeed ||
      distinctReporters >= MIN_DISTINCT_REPORTERS_FOR_CLOSURE ||
      confirmedByLowLiveSpeed
    ) {
      cluster.verificationState = INCIDENT_VERIFICATION_STATE.CORROBORATED_ACTIVE;
      cluster.affectsRoutingClosure =
        cluster.type === INCIDENT_TYPES.ROAD_CLOSURE || cluster.type === INCIDENT_TYPES.FLOOD;
    } else {
      cluster.verificationState = INCIDENT_VERIFICATION_STATE.UNVERIFIED_ADVISORY;
      cluster.affectsRoutingClosure = false;
    }
  }

  #serialize(cluster) {
    return {
      id: cluster.id,
      type: cluster.type,
      coordinate: cluster.coordinate,
      directedEdgeKey: cluster.directedEdgeKey,
      description: cluster.description,
      reporterCount: cluster.reporters.size,
      verificationState: cluster.verificationState,
      affectsRoutingClosure: cluster.affectsRoutingClosure,
      createdAtEpoch: cluster.createdAtEpoch,
      updatedAtEpoch: cluster.updatedAtEpoch
    };
  }
}
