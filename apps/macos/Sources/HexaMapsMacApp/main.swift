import AppKit
import HexaMapCore
import SwiftUI

@main
struct HexaMapsMacApp: App {
    @StateObject private var viewModel = HexaMapViewModel(
        initialCamera: MapCameraState(center: .bengaluruPilot, zoom: 12.5, bearingDegrees: 0.0),
        styleVariant: .light2D
    )

    private let canvas: HexaWKWebViewMapCanvas

    init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let tileDir = appSupport.appendingPathComponent("HexaMaps/Tiles", isDirectory: true)
        try? FileManager.default.createDirectory(at: tileDir, withIntermediateDirectories: true)

        self.canvas = HexaWKWebViewMapCanvas(
            tileDirectory: tileDir,
            initialCamera: MapCameraState(center: .bengaluruPilot, zoom: 12.5, bearingDegrees: 0.0),
            initialStyle: .light2D
        )
    }

    var body: some Scene {
        WindowGroup("HEXA MAPS — Bengaluru") {
            HexaMapsMacMainView(viewModel: viewModel, canvas: canvas)
                .frame(minWidth: 1024, minHeight: 700)
                .onAppear {
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                    viewModel.attachCanvas(canvas)
                }
        }
    }
}
