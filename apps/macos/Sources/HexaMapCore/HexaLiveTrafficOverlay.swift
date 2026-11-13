import Foundation

public struct HexaTrafficEdgeOverlay: Equatable, Codable, Identifiable, Sendable {
    public let id: String
    public let graphVersionId: String
    public let roadName: String
    public let highwayShield: HighwayShieldBadge?
    public let coordinates: [GeoCoordinate]
    public let lengthMeters: Int
    public let state: HexaTrafficConfidenceState
    public let effectiveSpeedKph: Double?
    public let freeFlowSpeedKph: Double
    public let contributorCount: Int
    public let confidenceScore: Double

    public init(
        id: String,
        graphVersionId: String,
        roadName: String,
        highwayShield: HighwayShieldBadge?,
        coordinates: [GeoCoordinate],
        lengthMeters: Int,
        state: HexaTrafficConfidenceState,
        effectiveSpeedKph: Double?,
        freeFlowSpeedKph: Double,
        contributorCount: Int,
        confidenceScore: Double
    ) {
        self.id = id
        self.graphVersionId = graphVersionId
        self.roadName = roadName
        self.highwayShield = highwayShield
        self.coordinates = coordinates
        self.lengthMeters = lengthMeters
        self.freeFlowSpeedKph = freeFlowSpeedKph
        self.contributorCount = contributorCount
        // Privacy & Honesty invariant: if contributorCount < 5 and state is live, force downgrade to noData
        if (state == .live || state == .liveLowConfidence) && contributorCount < 5 {
            self.state = .noData
            self.effectiveSpeedKph = nil
            self.confidenceScore = 0.0
        } else {
            self.state = state
            self.effectiveSpeedKph = effectiveSpeedKph
            self.confidenceScore = confidenceScore
        }
    }

    /// Returns the hex color string for the 2D traffic overlay, or `nil` when `state.allowsLiveTrafficColorOverlay == false`.
    /// `NO_DATA`, `HISTORICAL`, `ESTIMATED`, and `STALE` never return a live green color.
    public var liveOverlayHexColor: String? {
        guard state.allowsLiveTrafficColorOverlay, let speed = effectiveSpeedKph, freeFlowSpeedKph > 0 else {
            return nil
        }
        let ratio = speed / freeFlowSpeedKph
        if ratio >= 0.75 { return "#16A34A" } // Free flow (Green)
        if ratio >= 0.45 { return "#F59E0B" } // Moderate congestion (Amber)
        if ratio >= 0.22 { return "#EF4444" } // Heavy congestion (Red)
        return "#7F1D1D"                      // Severe gridlock (Dark Red)
    }
}

public struct HexaDynamicRerouteRecommendation: Equatable, Sendable {
    public let currentRouteId: String
    public let fasterRoute: HexaPlannedRoute
    public let timeSavedSeconds: Int
    public let reasonSummary: String
}

/// Evaluates active navigation routes against incoming `HexaTrafficEdgeOverlay` snapshots
/// and triggers dynamic rerouting when live congestion delays the current route (`Gate 5`).
@MainActor
public final class HexaLiveTrafficCoordinator {
    public let expectedGraphVersionId: String
    public private(set) var activeOverlays: [String: HexaTrafficEdgeOverlay] = [:]

    public init(expectedGraphVersionId: String) {
        self.expectedGraphVersionId = expectedGraphVersionId
    }

    public func applyTrafficSnapshot(_ overlays: [HexaTrafficEdgeOverlay]) throws {
        for edge in overlays {
            guard edge.graphVersionId == expectedGraphVersionId else {
                throw NSError(
                    domain: "HexaTrafficGraphVersionMismatch",
                    code: 409,
                    userInfo: [
                        NSLocalizedDescriptionKey: "Traffic edge \(edge.id) targets graph \(edge.graphVersionId), expected \(expectedGraphVersionId)"
                    ]
                )
            }
            activeOverlays[edge.id] = edge
        }
    }

    /// Evaluates whether an alternative route saves >= 120 seconds under current live traffic.
    public func evaluateDynamicReroute(
        currentRoute: HexaPlannedRoute,
        currentRouteEdgeIds: [String],
        alternateRoute: HexaPlannedRoute,
        alternateRouteEdgeIds: [String]
    ) -> HexaDynamicRerouteRecommendation? {
        let currentEta = computeTrafficAwareDurationSeconds(edgeIds: currentRouteEdgeIds, fallback: currentRoute.totalDurationSeconds)
        let altEta = computeTrafficAwareDurationSeconds(edgeIds: alternateRouteEdgeIds, fallback: alternateRoute.totalDurationSeconds)

        let saved = currentEta - altEta
        guard saved >= 120 else { return nil }

        return HexaDynamicRerouteRecommendation(
            currentRouteId: currentRoute.id,
            fasterRoute: alternateRoute,
            timeSavedSeconds: saved,
            reasonSummary: "Severe live congestion ahead; alternate route saves \(saved / 60) min"
        )
    }

    public func computeTrafficAwareDurationSeconds(edgeIds: [String], fallback: Int) -> Int {
        guard !edgeIds.isEmpty else { return fallback }
        var totalSeconds = 0.0
        for id in edgeIds {
            guard let edge = activeOverlays[id] else {
                return fallback
            }
            let speedKph = (edge.state.allowsLiveTrafficColorOverlay ? edge.effectiveSpeedKph : nil) ?? edge.freeFlowSpeedKph
            let mps = max(0.8, speedKph / 3.6)
            totalSeconds += Double(edge.lengthMeters) / mps
        }
        return Int(totalSeconds.rounded())
    }
}
