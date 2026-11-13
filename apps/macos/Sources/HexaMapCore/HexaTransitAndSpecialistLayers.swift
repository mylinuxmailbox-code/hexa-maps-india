import Combine
import Foundation

public enum HexaTransitFeedStatus: String, Codable, Sendable {
    case realtimeVerified = "REALTIME_VERIFIED"
    case staticSchedule = "STATIC_SCHEDULE"
    case dataGap = "DATA_GAP"
}

public struct HexaTransitLeg: Equatable, Codable, Identifiable, Sendable {
    public let id: String
    public let mode: String // WALK, SUBWAY, BUS, RAIL
    public let agencyName: String?
    public let routeShortName: String?
    public let routeColorHex: String?
    public let fromStopName: String
    public let toStopName: String
    public let durationSeconds: Int
    public let departureStatus: HexaTransitFeedStatus
    public let vehiclePositionStatus: HexaTransitFeedStatus

    public init(
        id: String,
        mode: String,
        agencyName: String?,
        routeShortName: String?,
        routeColorHex: String?,
        fromStopName: String,
        toStopName: String,
        durationSeconds: Int,
        departureStatus: HexaTransitFeedStatus,
        vehiclePositionStatus: HexaTransitFeedStatus
    ) {
        self.id = id
        self.mode = mode
        self.agencyName = agencyName
        self.routeShortName = routeShortName
        self.routeColorHex = routeColorHex
        self.fromStopName = fromStopName
        self.toStopName = toStopName
        self.durationSeconds = durationSeconds
        self.departureStatus = departureStatus
        self.vehiclePositionStatus = vehiclePositionStatus
    }
}

public enum HexaSpecialized2DLayer: String, Codable, CaseIterable, Sendable {
    case publicTransit = "public_transit_2d"
    case cyclingNetwork = "cycling_network_2d"
    case hillshadeDEM2D = "hillshade_dem_2d"
    case evChargers = "ev_chargers"
    case airQuality = "air_quality"
    case weather = "weather"
}

/// Manages Public Transit Itineraries (BMRCL Namma Metro & BMTC) and 2D Specialized Map Layers (`Gate 8`).
/// Strictly enforces:
/// - Honest feed labeling (`STATIC_SCHEDULE` vs `REALTIME_VERIFIED` vs `DATA_GAP`).
/// - Coarse coordinate rounding (`0.01°` ≈ 1.1 km) before querying external Weather/AQI/AI providers.
/// - Zero 3D terrain meshes (elevation is strictly 2D hillshade + 2D profile chart).
@MainActor
public final class HexaTransitAndLayersController: ObservableObject {
    @Published public private(set) var enabledLayers: Set<HexaSpecialized2DLayer> = []
    @Published public private(set) var activeTransitLegs: [HexaTransitLeg] = []

    public init() {}

    public func toggleLayer(_ layer: HexaSpecialized2DLayer) {
        if enabledLayers.contains(layer) {
            enabledLayers.remove(layer)
        } else {
            enabledLayers.insert(layer)
        }
    }

    public func loadBengaluruSampleMetroAndBusItinerary(bmtcRealtimeEnabled: Bool = false) {
        self.activeTransitLegs = [
            HexaTransitLeg(
                id: "leg-bmrcl-purple",
                mode: "SUBWAY",
                agencyName: "BMRCL Namma Metro",
                routeShortName: "Purple Line",
                routeColorHex: "#7E22CE",
                fromStopName: "MG Road Metro Station",
                toStopName: "Majestic (Nadaprabhu Kempegowda)",
                durationSeconds: 540,
                departureStatus: .staticSchedule,
                vehiclePositionStatus: .dataGap
            ),
            HexaTransitLeg(
                id: "leg-bmtc-kia9",
                mode: "BUS",
                agencyName: "BMTC",
                routeShortName: "KIA-9",
                routeColorHex: "#0284C7",
                fromStopName: "Majestic Bus Stand",
                toStopName: "Hebbal Flyover",
                durationSeconds: 1500,
                departureStatus: bmtcRealtimeEnabled ? .realtimeVerified : .staticSchedule,
                vehiclePositionStatus: bmtcRealtimeEnabled ? .realtimeVerified : .dataGap
            )
        ]
    }

    /// Coarsens a coordinate to `0.01°` (~1.1 km) before sending to external Weather, AQI, or optional AI providers.
    public static func coarsenForExternalProvider(_ coordinate: GeoCoordinate) -> GeoCoordinate {
        let lat = (coordinate.latitude * 100.0).rounded() / 100.0
        let lon = (coordinate.longitude * 100.0).rounded() / 100.0
        return GeoCoordinate(latitude: lat, longitude: lon)
    }
}
