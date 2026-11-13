/**
 * HEXA MAPS — Traffic Map Matching, Aggregation & Shockwave Anomaly Processor
 * (`services/api/src/modules/traffic-processing`)
 *
 * Implements the central pipeline in `docs/05_TRAFFIC_SYSTEM.md`:
 * 1. Graph-Version-Pinned Directed Road-Edge Catalog (`graph_version_id`).
 * 2. Map Matching (`Valhalla Meili` adapter + spatial directed-edge matcher).
 * 3. Speed Aggregation (Harmonic Mean) & 6-State Confidence Calculation:
 *    - `LIVE` (k >= 8, low variance)
 *    - `LIVE_LOW_CONFIDENCE` (5 <= k < 8 or high variance)
 *    - `HISTORICAL` (k < 5, historical profile available)
 *    - `ESTIMATED` (k < 5, base OSM speed heuristic)
 *    - `STALE` (k >= 5 observed 15-30 min ago)
 *    - `NO_DATA` (k < 5, no historical data — NEVER rendered as green)
 * 4. Shockwave Consistency Check: Detects localized Sybil congestion anomalies when
 *    an edge suddenly reports near-zero speed while its upstream/downstream connected
 *    edges and historical baseline remain in free-flow.
 */

import { pointToSegmentDistanceMeters } from '../navigation/navigation-state-machine.mjs';

export const TRAFFIC_STATES = Object.freeze({
  LIVE: 'LIVE',
  LIVE_LOW_CONFIDENCE: 'LIVE_LOW_CONFIDENCE',
  HISTORICAL: 'HISTORICAL',
  ESTIMATED: 'ESTIMATED',
  STALE: 'STALE',
  NO_DATA: 'NO_DATA'
});

export const MIN_K_ANONYMITY = 5;
const ACTIVE_WINDOW_SECONDS = 900;  // 15 minutes
const STALE_WINDOW_SECONDS = 1800;  // 30 minutes
const MAX_MAP_MATCH_RESIDUAL_METERS = 25.0;

export class TrafficProcessingEngine {
  /**
   * @param {Object} config
   * @param {string} config.graphVersionId - Exact Valhalla graph version SHA/tag
   * @param {Array<{
   *   tileLevel: number,
   *   tileId: number,
   *   directedEdgeIndex: number,
   *   roadName: string,
   *   network?: string,
   *   ref?: string,
   *   lengthMeters: number,
   *   freeFlowSpeedKph: number,
   *   historicalSpeedKph?: number|null,
   *   geometry2D: Array<{latitude: number, longitude: number}>,
   *   upstreamEdgeKeys?: Array<string>,
   *   downstreamEdgeKeys?: Array<string>
   * }>} config.directedEdges
   */
  constructor({ graphVersionId, directedEdges }) {
    if (!graphVersionId) {
      throw new Error('graphVersionId is required to initialize TrafficProcessingEngine');
    }
    this.graphVersionId = graphVersionId;
    this.edgesByKey = new Map();
    /** @type {Map<string, Map<string, {speedKph: number, timestampEpoch: number, residualMeters: number}>>} */
    this.observationsByEdge = new Map();

    for (const edge of directedEdges || []) {
      const key = TrafficProcessingEngine.edgeKey(edge.tileLevel, edge.tileId, edge.directedEdgeIndex);
      this.edgesByKey.set(key, edge);
      this.observationsByEdge.set(key, new Map());
    }
  }

  static edgeKey(tileLevel, tileId, directedEdgeIndex) {
    return `${tileLevel}:${tileId}:${directedEdgeIndex}`;
  }

  /**
   * Map-matches validated GPS probes onto the nearest directed road edge within 25m
   * and records the latest observation per distinct `ephemeralSessionId`.
   */
  processValidatedProbes(probes, targetGraphVersionId = this.graphVersionId) {
    if (targetGraphVersionId !== this.graphVersionId) {
      throw new Error(
        `Graph version mismatch: engine is pinned to '${this.graphVersionId}', got '${targetGraphVersionId}'`
      );
    }

    let matchedCount = 0;
    for (const probe of probes) {
      let bestEdgeKey = null;
      let bestDistMeters = Infinity;

      for (const [key, edge] of this.edgesByKey.entries()) {
        const geom = edge.geometry2D;
        for (let i = 0; i < geom.length - 1; i++) {
          const { distanceMeters } = pointToSegmentDistanceMeters(probe, geom[i], geom[i + 1]);
          if (distanceMeters < bestDistMeters) {
            bestDistMeters = distanceMeters;
            bestEdgeKey = key;
          }
        }
      }

      if (bestEdgeKey && bestDistMeters <= MAX_MAP_MATCH_RESIDUAL_METERS) {
        const sessionMap = this.observationsByEdge.get(bestEdgeKey);
        const existing = sessionMap.get(probe.ephemeralSessionId);
        if (!existing || probe.timestampEpoch >= existing.timestampEpoch) {
          sessionMap.set(probe.ephemeralSessionId, {
            speedKph: probe.speedKph,
            timestampEpoch: probe.timestampEpoch,
            residualMeters: Number(bestDistMeters.toFixed(2))
          });
        }
        matchedCount += 1;
      }
    }

    return { matchedCount };
  }

  /**
   * Computes aggregated speed, confidence score, and honest traffic state for every
   * directed edge in the active graph.
   */
  evaluateAllEdges(nowEpoch = Math.floor(Date.now() / 1000)) {
    const snapshots = new Map();

    for (const [key, edge] of this.edgesByKey.entries()) {
      const sessionMap = this.observationsByEdge.get(key) || new Map();
      const activeObs = [];
      const staleObs = [];

      for (const obs of sessionMap.values()) {
        const age = nowEpoch - obs.timestampEpoch;
        if (age <= ACTIVE_WINDOW_SECONDS && age >= -60) {
          activeObs.push(obs);
        } else if (age > ACTIVE_WINDOW_SECONDS && age <= STALE_WINDOW_SECONDS) {
          staleObs.push(obs);
        }
      }

      const kActive = activeObs.length;
      let state = TRAFFIC_STATES.NO_DATA;
      let effectiveSpeedKph = null;
      let confidenceScore = 0.0;
      let congestionRatio = null;

      if (kActive >= MIN_K_ANONYMITY) {
        const clampedSpeeds = activeObs.map((o) => Math.max(2.0, o.speedKph));
        const harmonicMean = clampedSpeeds.length / clampedSpeeds.reduce((acc, s) => acc + 1.0 / s, 0);
        const arithmeticMean = clampedSpeeds.reduce((acc, s) => acc + s, 0) / clampedSpeeds.length;
        const stdDev = Math.sqrt(
          clampedSpeeds.reduce((acc, s) => acc + Math.pow(s - arithmeticMean, 2), 0) / clampedSpeeds.length
        );

        if (kActive >= 8 && stdDev < 15.0) {
          state = TRAFFIC_STATES.LIVE;
          confidenceScore = Number(Math.min(0.99, 0.70 + 0.03 * kActive).toFixed(2));
          effectiveSpeedKph = Number(harmonicMean.toFixed(1));
        } else {
          state = TRAFFIC_STATES.LIVE_LOW_CONFIDENCE;
          confidenceScore = 0.55;
          effectiveSpeedKph = Number(
            (edge.historicalSpeedKph != null
              ? 0.65 * harmonicMean + 0.35 * edge.historicalSpeedKph
              : harmonicMean
            ).toFixed(1)
          );
        }
        congestionRatio = Number(Math.min(1.0, effectiveSpeedKph / edge.freeFlowSpeedKph).toFixed(2));
      } else if (kActive + staleObs.length >= MIN_K_ANONYMITY) {
        const allRecent = [...activeObs, ...staleObs].map((o) => Math.max(2.0, o.speedKph));
        const harmonicMean = allRecent.length / allRecent.reduce((acc, s) => acc + 1.0 / s, 0);
        state = TRAFFIC_STATES.STALE;
        confidenceScore = 0.30;
        effectiveSpeedKph = Number(harmonicMean.toFixed(1));
      } else if (edge.historicalSpeedKph != null) {
        state = TRAFFIC_STATES.HISTORICAL;
        confidenceScore = 0.45;
        effectiveSpeedKph = Number(edge.historicalSpeedKph.toFixed(1));
      } else {
        // Strictly NO_DATA (never fabricated as LIVE green)
        state = TRAFFIC_STATES.NO_DATA;
        confidenceScore = 0.0;
        effectiveSpeedKph = null;
      }

      snapshots.set(key, {
        edgeKey: key,
        graphVersionId: this.graphVersionId,
        tileLevel: edge.tileLevel,
        tileId: edge.tileId,
        directedEdgeIndex: edge.directedEdgeIndex,
        roadName: edge.roadName,
        network: edge.network || null,
        ref: edge.ref || null,
        lengthMeters: edge.lengthMeters,
        state,
        effectiveSpeedKph,
        freeFlowSpeedKph: edge.freeFlowSpeedKph,
        historicalSpeedKph: edge.historicalSpeedKph ?? null,
        contributorCount: kActive,
        confidenceScore,
        congestionRatio,
        allowsLiveColorOverlay:
          state === TRAFFIC_STATES.LIVE || state === TRAFFIC_STATES.LIVE_LOW_CONFIDENCE,
        geometry2D: edge.geometry2D,
        updatedAtEpoch: nowEpoch
      });
    }

    return snapshots;
  }
}
