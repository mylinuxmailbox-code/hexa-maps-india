import Combine
import Foundation

public enum HexaRoadIncidentType: String, Codable, CaseIterable, Sendable {
    case accident = "ACCIDENT"
    case roadClosure = "ROAD_CLOSURE"
    case construction = "CONSTRUCTION"
    case flood = "FLOOD"
    case brokenDownVehicle = "BROKEN_DOWN_VEHICLE"
}

public enum HexaIncidentVerificationState: String, Codable, Sendable {
    case unverifiedAdvisory = "UNVERIFIED_ADVISORY"
    case corroboratedActive = "CORROBORATED_ACTIVE"
}

public struct HexaRoadIncidentReport: Equatable, Codable, Identifiable, Sendable {
    public let id: String
    public let type: HexaRoadIncidentType
    public let coordinate: GeoCoordinate
    public let description: String
    public private(set) var reporterIds: Set<String>
    public let isOfficialFeed: Bool

    public var verificationState: HexaIncidentVerificationState {
        if isOfficialFeed || reporterIds.count >= 3 {
            return .corroboratedActive
        }
        return .unverifiedAdvisory
    }

    public var affectsRoutingClosure: Bool {
        guard verificationState == .corroboratedActive else { return false }
        return type == .roadClosure || type == .flood
    }

    public init(
        id: String,
        type: HexaRoadIncidentType,
        coordinate: GeoCoordinate,
        description: String,
        reporterIds: Set<String>,
        isOfficialFeed: Bool = false
    ) {
        self.id = id
        self.type = type
        self.coordinate = coordinate
        self.description = description
        self.reporterIds = reporterIds
        self.isOfficialFeed = isOfficialFeed
    }

    public mutating func addCorroboration(from reporterId: String) {
        reporterIds.insert(reporterId)
    }
}

public struct HexaSavedPlaceList: Equatable, Codable, Identifiable, Sendable {
    public let id: String
    public var title: String
    public var placeIds: [String]
    public var isShared: Bool

    public init(id: String, title: String, placeIds: [String] = [], isShared: Bool = false) {
        self.id = id
        self.title = title
        self.placeIds = placeIds
        self.isShared = isShared
    }
}

/// Manages Saved Places, Custom Lists, and Corroborated Community Incident Reports on macOS (`Gate 7`).
/// Core map usage works without an account; saved places persist locally on-device by default.
@MainActor
public final class HexaCommunityAndSavedPlacesManager: ObservableObject {
    @Published public private(set) var savedLists: [HexaSavedPlaceList] = [
        HexaSavedPlaceList(id: "favorites", title: "Favorites", placeIds: [])
    ]
    @Published public private(set) var activeIncidents: [HexaRoadIncidentReport] = []

    public init() {}

    public func savePlace(_ placeId: String, toListId listId: String = "favorites") {
        guard let idx = savedLists.firstIndex(where: { $0.id == listId }) else { return }
        if !savedLists[idx].placeIds.contains(placeId) {
            savedLists[idx].placeIds.append(placeId)
        }
    }

    public func createList(id: String, title: String, isShared: Bool = false) {
        guard !savedLists.contains(where: { $0.id == id }) else { return }
        savedLists.append(HexaSavedPlaceList(id: id, title: title, placeIds: [], isShared: isShared))
    }

    @discardableResult
    public func reportOrCorroborateIncident(
        type: HexaRoadIncidentType,
        coordinate: GeoCoordinate,
        description: String,
        reporterId: String,
        isOfficialFeed: Bool = false
    ) -> HexaRoadIncidentReport {
        if let existingIdx = activeIncidents.firstIndex(where: {
            $0.type == type && HexaSearchAndPlaceEngine.haversineMeters($0.coordinate, coordinate) <= 100.0
        }) {
            activeIncidents[existingIdx].addCorroboration(from: reporterId)
            return activeIncidents[existingIdx]
        }

        let newReport = HexaRoadIncidentReport(
            id: "inc-\(activeIncidents.count + 1)",
            type: type,
            coordinate: coordinate,
            description: description,
            reporterIds: [reporterId],
            isOfficialFeed: isOfficialFeed
        )
        activeIncidents.append(newReport)
        return newReport
    }
}
