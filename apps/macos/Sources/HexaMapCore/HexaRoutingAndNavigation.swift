import AVFoundation
import Combine
import Foundation

public enum HexaTravelMode: String, Codable, CaseIterable, Sendable {
    case driving = "driving"
    case walking = "walking"
    case cycling = "cycling"
    case hiking = "hiking"
    case wheelchair = "wheelchair"
}

public struct HexaRoutingOptions: Equatable, Codable, Sendable {
    public var avoidTolls: Bool
    public var avoidHighways: Bool
    public var avoidFerries: Bool
    public var preferAccessiblePaths: Bool
    public var preferCyclingPaths: Bool

    public init(
        avoidTolls: Bool = false,
        avoidHighways: Bool = false,
        avoidFerries: Bool = false,
        preferAccessiblePaths: Bool = false,
        preferCyclingPaths: Bool = false
    ) {
        self.avoidTolls = avoidTolls
        self.avoidHighways = avoidHighways
        self.avoidFerries = avoidFerries
        self.preferAccessiblePaths = preferAccessiblePaths
        self.preferCyclingPaths = preferCyclingPaths
    }
}

public struct HexaRouteManeuver: Equatable, Codable, Identifiable, Sendable {
    public let id: Int
    public let instruction: String
    public let verbalPrompt: String
    public let distanceMeters: Int
    public let durationSeconds: Int
    public let beginShapeIndex: Int
    public let endShapeIndex: Int
    public let highwayShields: [HighwayShieldBadge]

    public init(
        id: Int,
        instruction: String,
        verbalPrompt: String,
        distanceMeters: Int,
        durationSeconds: Int,
        beginShapeIndex: Int,
        endShapeIndex: Int,
        highwayShields: [HighwayShieldBadge] = []
    ) {
        self.id = id
        self.instruction = instruction
        self.verbalPrompt = verbalPrompt
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
        self.beginShapeIndex = beginShapeIndex
        self.endShapeIndex = endShapeIndex
        self.highwayShields = highwayShields
    }
}

public struct HexaPlannedRoute: Equatable, Codable, Identifiable, Sendable {
    public let id: String
    public let isPrimary: Bool
    public let mode: HexaTravelMode
    public let geometry2D: [GeoCoordinate]
    public let maneuvers: [HexaRouteManeuver]
    public let totalDistanceMeters: Int
    public let totalDurationSeconds: Int
    public let trafficConfidence: HexaTrafficConfidenceState
    public let graphVersionId: String

    public init(
        id: String,
        isPrimary: Bool,
        mode: HexaTravelMode,
        geometry2D: [GeoCoordinate],
        maneuvers: [HexaRouteManeuver],
        totalDistanceMeters: Int,
        totalDurationSeconds: Int,
        trafficConfidence: HexaTrafficConfidenceState,
        graphVersionId: String
    ) {
        self.id = id
        self.isPrimary = isPrimary
        self.mode = mode
        self.geometry2D = geometry2D
        self.maneuvers = maneuvers
        self.totalDistanceMeters = totalDistanceMeters
        self.totalDurationSeconds = totalDurationSeconds
        self.trafficConfidence = trafficConfidence
        self.graphVersionId = graphVersionId
    }
}

public enum HexaNavigationState: String, Codable, Sendable {
    case idle = "IDLE"
    case active = "ACTIVE"
    case rerouting = "REROUTING"
    case paused = "PAUSED"
    case arrived = "ARRIVED"
}

/// Protocol abstracting native speech synthesis (`AVSpeechSynthesizer` on macOS/iOS)
/// so voice guidance can be verified deterministically in headless tests.
@MainActor
public protocol HexaVoiceGuidanceSpeakerProtocol: AnyObject {
    var isMuted: Bool { get set }
    var spokenHistory: [String] { get }
    func speak(_ utteranceText: String)
}

@MainActor
public final class HexaAVSpeechGuidanceSpeaker: HexaVoiceGuidanceSpeakerProtocol {
    public var isMuted: Bool = false
    public private(set) var spokenHistory: [String] = []
    private let synthesizer = AVSpeechSynthesizer()

    public init() {}

    public func speak(_ utteranceText: String) {
        guard !isMuted, !utteranceText.isEmpty else { return }
        spokenHistory.append(utteranceText)
        let utterance = AVSpeechUtterance(string: utteranceText)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-IN") ?? AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.speak(utterance)
    }
}

/// Turn-by-Turn Navigation State Machine for macOS & iOS (`Gate 4`).
/// Implements:
/// - Active route tracking & upcoming maneuver progress
/// - Off-route deviation detection (> 45m for 2 consecutive GPS fixes) & automatic rerouting
/// - Current speed & speed-limit comparison
/// - Voice guidance prompts at 500m pre-transition, 60m transition, rerouting, and arrival
@MainActor
public final class HexaNavigationController: ObservableObject {
    @Published public private(set) var state: HexaNavigationState = .idle
    @Published public private(set) var activeRoute: HexaPlannedRoute?
    @Published public private(set) var currentManeuverIndex: Int = 0
    @Published public private(set) var distanceToNextManeuverMeters: Int = 0
    @Published public private(set) var remainingDistanceMeters: Int = 0
    @Published public private(set) var remainingDurationSeconds: Int = 0
    @Published public private(set) var currentSpeedKph: Int = 0
    @Published public private(set) var currentSpeedLimitKph: Int?
    @Published public private(set) var isOverSpeedLimit: Bool = false

    public let voiceSpeaker: any HexaVoiceGuidanceSpeakerProtocol
    private var consecutiveOffRouteFixes: Int = 0
    private var announcedThresholds: Set<String> = []

    public init(voiceSpeaker: any HexaVoiceGuidanceSpeakerProtocol) {
        self.voiceSpeaker = voiceSpeaker
    }

    public func startNavigation(with route: HexaPlannedRoute) {
        self.activeRoute = route
        self.state = .active
        self.currentManeuverIndex = 0
        self.consecutiveOffRouteFixes = 0
        self.announcedThresholds.removeAll()
        self.remainingDistanceMeters = route.totalDistanceMeters
        self.remainingDurationSeconds = route.totalDurationSeconds
        if let first = route.maneuvers.first {
            voiceSpeaker.speak(first.verbalPrompt)
        }
    }

    public func pauseNavigation() {
        guard state == .active else { return }
        state = .paused
    }

    public func resumeNavigation() {
        guard state == .paused else { return }
        state = .active
    }

    public func stopNavigation() {
        state = .idle
        activeRoute = nil
        consecutiveOffRouteFixes = 0
        announcedThresholds.removeAll()
    }

    public func processLocationFix(
        coordinate: GeoCoordinate,
        speedKph: Double,
        speedLimitKph: Int? = nil
    ) {
        guard let route = activeRoute, state == .active || state == .rerouting else { return }
        let geom = route.geometry2D
        guard let destination = geom.last else { return }

        self.currentSpeedKph = Int(speedKph.rounded())
        self.currentSpeedLimitKph = speedLimitKph
        if let limit = speedLimitKph {
            self.isOverSpeedLimit = speedKph > Double(limit + 3)
        } else {
            self.isOverSpeedLimit = false
        }

        let distToDest = HexaSearchAndPlaceEngine.haversineMeters(coordinate, destination)
        if distToDest <= 30.0 {
            self.state = .arrived
            self.remainingDistanceMeters = 0
            self.remainingDurationSeconds = 0
            self.distanceToNextManeuverMeters = 0
            voiceSpeaker.speak("You have arrived at your destination.")
            return
        }

        // Compute minimum cross-track distance to route segments
        var minCrossTrack = Double.greatestFiniteMagnitude
        var closestVertex = 0
        for i in 0..<(geom.count - 1) {
            let d = Self.pointToSegmentMeters(point: coordinate, a: geom[i], b: geom[i + 1])
            if d < minCrossTrack {
                minCrossTrack = d
                closestVertex = i
            }
        }

        if minCrossTrack > 45.0 {
            consecutiveOffRouteFixes += 1
            if consecutiveOffRouteFixes >= 2 {
                self.state = .rerouting
                voiceSpeaker.speak("Recalculating route.")
                return
            }
        } else {
            consecutiveOffRouteFixes = 0
            self.state = .active
        }

        // Advance maneuver index
        for idx in currentManeuverIndex..<route.maneuvers.count {
            if closestVertex >= route.maneuvers[idx].beginShapeIndex {
                currentManeuverIndex = min(route.maneuvers.count - 1, idx + 1)
            }
        }

        let maneuver = route.maneuvers[currentManeuverIndex]
        let targetCoord = maneuver.beginShapeIndex < geom.count
            ? geom[maneuver.beginShapeIndex]
            : destination

        let distToManeuver = Int(HexaSearchAndPlaceEngine.haversineMeters(coordinate, targetCoord).rounded())
        self.distanceToNextManeuverMeters = distToManeuver
        self.remainingDistanceMeters = Int(distToDest.rounded())
        let effectiveSpeedMps = max(2.5, speedKph / 3.6)
        self.remainingDurationSeconds = Int((distToDest / effectiveSpeedMps).rounded())

        let key500 = "\(currentManeuverIndex):500"
        let key60 = "\(currentManeuverIndex):60"
        if distToManeuver <= 60 && !announcedThresholds.contains(key60) {
            announcedThresholds.insert(key60)
            voiceSpeaker.speak(maneuver.verbalPrompt)
        } else if distToManeuver <= 500 && distToManeuver > 60 && !announcedThresholds.contains(key500) {
            announcedThresholds.insert(key500)
            voiceSpeaker.speak("In \(distToManeuver) meters, \(maneuver.instruction)")
        }
    }

    public static func pointToSegmentMeters(point: GeoCoordinate, a: GeoCoordinate, b: GeoCoordinate) -> Double {
        let cosLat = cos(point.latitude * .pi / 180.0)
        let mLat = 111_132.0
        let mLon = 111_320.0 * cosLat

        let ax = (a.longitude - point.longitude) * mLon
        let ay = (a.latitude - point.latitude) * mLat
        let bx = (b.longitude - point.longitude) * mLon
        let by = (b.latitude - point.latitude) * mLat

        let dx = bx - ax
        let dy = by - ay
        let lenSq = dx * dx + dy * dy
        var t = 0.0
        if lenSq > 1e-6 {
            t = max(0.0, min(1.0, -(ax * dx + ay * dy) / lenSq))
        }
        let px = ax + t * dx
        let py = ay + t * dy
        return sqrt(px * px + py * py)
    }
}
