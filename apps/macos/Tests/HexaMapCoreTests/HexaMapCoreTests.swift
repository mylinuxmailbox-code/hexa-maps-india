import Foundation
import Testing
@testable import HexaMapCore

@MainActor
final class MockMapCanvas: HexaMapCanvasProtocol {
    private(set) var currentCamera = MapCameraState(center: .bengaluruPilot, zoom: 12.0)
    private(set) var currentStyle: MapStyleVariant = .light2D
    private(set) var isTrafficOverlayEnabled: Bool = false
    private(set) var renderedSegments: [RenderedRouteSegment] = []

    func setCamera(_ camera: MapCameraState, animated: Bool) {
        self.currentCamera = camera
    }

    func setStyle(_ style: MapStyleVariant) {
        self.currentStyle = style
    }

    func setTrafficOverlayEnabled(_ enabled: Bool) {
        self.isTrafficOverlayEnabled = enabled
    }

    func setRouteSegments(_ segments: [RenderedRouteSegment]) {
        self.renderedSegments = segments
    }
}

@Suite("HEXA macOS Gate 1 Renderer & 2D Constraint Tests")
struct HexaMapCoreTests {

    @Test("Camera state permanently enforces 2D pitch = 0.0 and normalizes compass bearing")
    func testCameraEnforces2DConstraint() {
        let camera = MapCameraState(
            center: .bengaluruPilot,
            zoom: 14.0,
            bearingDegrees: -45.0
        )
        #expect(camera.pitchDegrees == 0.0)
        #expect(camera.bearingDegrees == 315.0)
        #expect(camera.center.latitude == 12.9716)
        #expect(camera.center.longitude == 77.5946)
    }

    @Test("Honest traffic state forbids rendering NO_DATA or HISTORICAL as live green traffic")
    func testHonestTrafficConfidenceRules() {
        #expect(HexaTrafficConfidenceState.live.allowsLiveTrafficColorOverlay == true)
        #expect(HexaTrafficConfidenceState.liveLowConfidence.allowsLiveTrafficColorOverlay == true)
        #expect(HexaTrafficConfidenceState.historical.allowsLiveTrafficColorOverlay == false)
        #expect(HexaTrafficConfidenceState.estimated.allowsLiveTrafficColorOverlay == false)
        #expect(HexaTrafficConfidenceState.stale.allowsLiveTrafficColorOverlay == false)
        #expect(HexaTrafficConfidenceState.noData.allowsLiveTrafficColorOverlay == false)
    }

    @Test("Local PMTiles HTTP Range parser handles byte-range requests accurately")
    func testPMTilesByteRangeParsing() {
        let range1 = HexaLocalTileSchemeHandler.parseByteRange(header: "bytes=0-511", totalLength: 4096)
        #expect(range1?.0 == 0)
        #expect(range1?.1 == 511)

        let rangeOpenEnd = HexaLocalTileSchemeHandler.parseByteRange(header: "bytes=1024-", totalLength: 4096)
        #expect(rangeOpenEnd?.0 == 1024)
        #expect(rangeOpenEnd?.1 == 4095)

        let invalidRange = HexaLocalTileSchemeHandler.parseByteRange(header: "bytes=5000-6000", totalLength: 4096)
        #expect(invalidRange == nil)
    }

    @Test("Generated MapLibre style JSON strictly locks projection to flat 2D mercator and pitch 0")
    func testStyleJSONIsStrictly2D() {
        let darkStyle = HexaLocalTileSchemeHandler.build2DStyleJSON(variant: MapStyleVariant.dark2D.rawValue)
        #expect(darkStyle.contains("\"pitch\": 0"))
        #expect(darkStyle.contains("\"type\": \"mercator\""))
        #expect(!darkStyle.contains("globe"))
        #expect(!darkStyle.contains("fill-extrusion"))
    }
}
