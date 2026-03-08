// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ClipfireiOS",
    platforms: [
        .iOS(.v17),
        .macOS(.v13)
    ],
    products: [
        .library(name: "ClipfireiOS", targets: ["ClipfireiOS"]),
        .executable(name: "ClipfireApp", targets: ["ClipfireApp"])
    ],
    dependencies: [
        .package(
            url: "https://github.com/google/GoogleSignIn-iOS",
            from: "8.0.0"
        ),
    ],
    targets: [
        .target(
            name: "ClipfireiOS",
            dependencies: [
                .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS"),
                .product(name: "GoogleSignInSwift", package: "GoogleSignIn-iOS"),
            ],
            path: "Sources/ClipfireiOS",
            resources: []
        ),
        .executableTarget(
            name: "ClipfireApp",
            dependencies: ["ClipfireiOS"],
            path: "Sources/ClipfireApp"
        ),
        .testTarget(
            name: "ClipfireiOSTests",
            dependencies: ["ClipfireiOS"],
            path: "Tests"
        )
    ]
)
