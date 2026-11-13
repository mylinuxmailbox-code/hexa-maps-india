// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HexaMapsMac",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "HexaMapCore",
            targets: ["HexaMapCore"]
        ),
        .executable(
            name: "HexaMapsMacApp",
            targets: ["HexaMapsMacApp"]
        )
    ],
    targets: [
        .target(
            name: "HexaMapCore",
            path: "Sources/HexaMapCore"
        ),
        .executableTarget(
            name: "HexaMapsMacApp",
            dependencies: ["HexaMapCore"],
            path: "Sources/HexaMapsMacApp"
        )
    ]
)
