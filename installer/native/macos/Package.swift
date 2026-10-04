// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TresekoInstaller",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "TresekoInstaller", targets: ["TresekoInstaller"])],
    targets: [.executableTarget(name: "TresekoInstaller")]
)
