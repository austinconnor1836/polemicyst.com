// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PolemicystiOS",
    platforms: [
        .iOS(.v17),
        .macOS(.v13)
    ],
    products: [
        .library(name: "PolemicystiOS", targets: ["PolemicystiOS"]),
        .executable(name: "PolemicystApp", targets: ["PolemicystApp"])
    ],
    targets: [
        .target(
            name: "PolemicystiOS",
            path: "Sources/PolemicystiOS",
            resources: []
        ),
        .executableTarget(
            name: "PolemicystApp",
            dependencies: ["PolemicystiOS"],
            path: "Sources/PolemicystApp"
        ),
        .testTarget(
            name: "PolemicystiOSTests",
            dependencies: ["PolemicystiOS"],
            path: "Tests"
        )
    ]
)
