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
    dependencies: [
        .package(
            url: "https://github.com/google/GoogleSignIn-iOS",
            from: "8.0.0"
        ),
    ],
    targets: [
        .target(
            name: "PolemicystiOS",
            dependencies: [
                .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS"),
                .product(name: "GoogleSignInSwift", package: "GoogleSignIn-iOS"),
            ],
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
