import AppKit
import CryptoKit
import Foundation
import SwiftUI

private let repository = "treseko/treseko-platform"
private let releasesURL = URL(string: "https://api.github.com/repos/treseko/treseko-platform/releases/latest")!
private let productVersionPattern = #"^treseko-community-v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$"#

struct GitHubRelease: Decodable {
    let draft: Bool
    let prerelease: Bool
    let tag_name: String
    let html_url: String
    let zipball_url: String
    let assets: [Asset]

    struct Asset: Decodable {
        let name: String
        let size: Int
        let browser_download_url: String
    }
}

struct DistributionIndex: Decodable {
    let schema: Int
    let product: String
    let product_version: String
    let installer_version: String
    let artifacts: [String: Artifact]

    struct Artifact: Decodable {
        let name: String
        let size: Int
        let sha256: String
    }
}

struct RuntimeStatus {
    let state: String
    let frontendVersion: String?
    let backendVersion: String?

    var message: String {
        switch state {
        case "running": return "Treseko en ejecución · Frontend y Backend \(frontendVersion ?? "?")"
        case "version_mismatch": return "Versiones distintas · Frontend \(frontendVersion ?? "?") · Backend \(backendVersion ?? "?")"
        case "not_running": return "No hay una instancia respondiendo en este puerto"
        default: return "Estado ambiguo · no se modificará ninguna instalación"
        }
    }
}

@MainActor
final class InstallerModel: ObservableObject {
    @Published var port = "9095"
    @Published var installRoot = ""
    @Published var targetRoot = ""
    @Published var latestVersion = "Consultando GitHub…"
    @Published var runtimeText = "Comprobando instancia local…"
    @Published var installerUpdateText = ""
    @Published var activity = "Listo para consultar Treseko Community."
    @Published var isWorking = false
    @Published var mode = "new"
    private var release: GitHubRelease?
    private var releaseVersion: String?
    private var runtime: RuntimeStatus?

    var currentBundle: URL { Bundle.main.bundleURL.standardizedFileURL }
    var isRunningFromAppBundle: Bool { currentBundle.pathExtension == "app" }

    func refresh() {
        Task {
            await loadLatestRelease()
            await inspectRuntime()
        }
    }

    func loadLatestRelease() async {
        do {
            var request = URLRequest(url: releasesURL, timeoutInterval: 20)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("Treseko-Installer-macOS", forHTTPHeaderField: "User-Agent")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw InstallerError.message("GitHub no respondió con un release disponible.")
            }
            let result = try JSONDecoder().decode(GitHubRelease.self, from: data)
            guard !result.draft, !result.prerelease,
                  let url = URL(string: result.html_url), url.host == "github.com",
                  url.path == "/\(repository)/releases/tag/\(result.tag_name)",
                  let archive = URL(string: result.zipball_url), archive.scheme == "https",
                  archive.host == "api.github.com",
                  let match = result.tag_name.range(of: productVersionPattern, options: .regularExpression) else {
                throw InstallerError.message("El release no coincide con el repositorio oficial o no es estable.")
            }
            let version = String(result.tag_name[match]).replacingOccurrences(of: "treseko-community-v", with: "")
            release = result
            releaseVersion = version
            latestVersion = "Última versión pública: \(version)"
            await inspectInstallerUpdate(result, productVersion: version)
            if installRoot.isEmpty {
                installRoot = findCachedInstallation()?.path ?? ""
            }
            updateAvailableMode()
        } catch {
            latestVersion = "No se pudo consultar GitHub: \(error.localizedDescription)"
        }
    }

    func inspectRuntime() async {
        guard let portNumber = Int(port), (1...65535).contains(portNumber) else {
            runtime = RuntimeStatus(state: "unknown", frontendVersion: nil, backendVersion: nil)
            runtimeText = "Puerto inválido"
            updateAvailableMode()
            return
        }
        do {
            let base = URL(string: "http://127.0.0.1:\(portNumber)")!
            let frontendData = try await fetch(base.appendingPathComponent("version.json"), timeout: 2)
            let frontend = try JSONSerialization.jsonObject(with: frontendData) as? [String: Any]
            guard frontend?["product"] as? String == "treseko-platform",
                  let frontendVersion = frontend?["version"] as? String else {
                runtime = RuntimeStatus(state: "occupied", frontendVersion: nil, backendVersion: nil)
                runtimeText = "El puerto está ocupado por otro servicio"
                updateAvailableMode()
                return
            }
            let healthData = try await fetch(base.appendingPathComponent("api/health"), timeout: 3)
            let health = try JSONSerialization.jsonObject(with: healthData) as? [String: Any]
            guard health?["status"] as? String == "ok", let backendVersion = health?["version"] as? String else {
                runtime = RuntimeStatus(state: "unverified", frontendVersion: frontendVersion, backendVersion: nil)
                runtimeText = "Treseko responde, pero el Backend no pudo verificarse"
                updateAvailableMode()
                return
            }
            let state = frontendVersion == backendVersion ? "running" : "version_mismatch"
            runtime = RuntimeStatus(state: state, frontendVersion: frontendVersion, backendVersion: backendVersion)
            runtimeText = runtime?.message ?? ""
        } catch {
            let nsError = error as NSError
            let refused = nsError.domain == NSURLErrorDomain && [NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost].contains(nsError.code)
            runtime = RuntimeStatus(state: refused ? "not_running" : "unknown", frontendVersion: nil, backendVersion: nil)
            runtimeText = runtime?.message ?? "No se pudo verificar la instancia"
        }
        updateAvailableMode()
    }

    func chooseInstallation() {
        let panel = NSOpenPanel()
        panel.title = "Elegir la raíz de la instalación Treseko"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url, isRecognizedInstallation(url) else {
            activity = "La carpeta no contiene una instalación reconocible; no se cambió el destino."
            return
        }
        installRoot = url.path
        refresh()
    }

    func installOrUpdate() {
        guard !isWorking else { return }
        Task { await performInstallOrUpdate() }
    }

    func updateInstaller() {
        guard !isWorking else { return }
        Task { await performInstallerUpdate() }
    }

    private func performInstallOrUpdate() async {
        isWorking = true
        defer { isWorking = false }
        do {
            guard let release, let releaseVersion else { throw InstallerError.message("Primero debe validarse el release de GitHub.") }
            await inspectRuntime()
            guard let runtime else { throw InstallerError.message("No se pudo determinar el estado de la instalación.") }
            let isRecognized = isRecognizedInstallation(URL(fileURLWithPath: installRoot))
            if runtime.state == "version_mismatch" || runtime.state == "occupied" || runtime.state == "unknown" || runtime.state == "unverified" {
                throw InstallerError.message("La instancia es ambigua o no está saludable. No se iniciará la instalación.")
            }
            if runtime.state == "running" && !isRecognized {
                throw InstallerError.message("Treseko está activo, pero su raíz no está seleccionada. Elegí la instalación correcta antes de actualizar.")
            }
            if runtime.state == "running" {
                guard try await runtimeMatchesInstallation(port: Int(port)!, root: URL(fileURLWithPath: installRoot)) else {
                    throw InstallerError.message("Docker no pudo vincular el servicio activo con la raíz seleccionada.")
                }
            }
            if isRecognized && hasUnfinishedUpdate(URL(fileURLWithPath: installRoot)) {
                throw InstallerError.message("Hay una transacción de actualización pendiente o interrumpida. No se iniciará otra.")
            }
            if runtime.state == "running", let current = runtime.frontendVersion,
               compare(releaseVersion, current) <= 0 {
                throw InstallerError.message("La versión disponible (\(releaseVersion)) no es posterior a la instalada (\(current)).")
            }
            if runtime.state == "not_running", isRecognized,
               let current = recordedVersion(URL(fileURLWithPath: installRoot)), compare(releaseVersion, current) <= 0 {
                throw InstallerError.message("La versión destino no es más nueva que la última versión registrada (\(current)).")
            }
            mode = isRecognized ? "update" : "new"
            let package = try await obtainPackage(release)
            try validatePackage(package, expectedVersion: releaseVersion)
            if mode == "new" && isRecognized { throw InstallerError.message("Ya hay una instalación en la raíz elegida; seleccioná Actualizar.") }
            let script = package.appendingPathComponent("scripts/install_local_treseko.sh")
            var arguments = [script.path, "--http-port", port]
            if mode == "update" {
                guard let root = installRoot.nilIfEmpty else { throw InstallerError.message("Seleccioná la raíz de la instalación existente.") }
                arguments.append(contentsOf: ["--update", "--install-root", root])
            }
            activity = "Instalando Treseko \(releaseVersion)…"
            let output = try await run("/bin/bash", arguments: arguments, currentDirectory: package)
            activity = output.isEmpty ? "Instalación completada. Verificando servicios…" : output
            await inspectRuntime()
            guard self.runtime?.state == "running", self.runtime?.frontendVersion == releaseVersion else {
                throw InstallerError.message("La instalación terminó, pero Frontend y Backend no confirmaron \(releaseVersion).")
            }
            activity = "Treseko \(releaseVersion) quedó instalado y verificado."
        } catch {
            activity = "No se completó la operación: \(error.localizedDescription)"
        }
    }

    private func performInstallerUpdate() async {
        isWorking = true
        defer { isWorking = false }
        do {
            guard let release, let version = releaseVersion else { throw InstallerError.message("No hay un release validado.") }
            let index = try await loadDistributionIndex(release, productVersion: version)
            let key = Self.macosArtifactKey
            guard let entry = index.artifacts[key] else { throw InstallerError.message("El release todavía no incluye un instalador macOS para este equipo.") }
            guard compare(index.installer_version, currentInstallerVersion()) > 0 else {
                throw InstallerError.message("Este instalador ya está actualizado.")
            }
            let asset = try asset(named: entry.name, in: release)
            let stageRoot = FileManager.default.temporaryDirectory.appendingPathComponent("treseko-installer-update-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: stageRoot, withIntermediateDirectories: true)
            let archive = stageRoot.appendingPathComponent(entry.name)
            try await downloadVerified(asset, expectedSize: entry.size, expectedSHA256: entry.sha256, to: archive)
            try launchBundleReplacement(archive: archive, stageRoot: stageRoot)
            activity = "Instalador verificado. Se cerrará y abrirá la nueva versión."
            NSApp.terminate(nil)
        } catch {
            activity = "No se pudo actualizar el instalador: \(error.localizedDescription)"
        }
    }

    private func inspectInstallerUpdate(_ release: GitHubRelease, productVersion: String) async {
        do {
            let index = try await loadDistributionIndex(release, productVersion: productVersion)
            guard index.artifacts[Self.macosArtifactKey] != nil else {
                installerUpdateText = "El release aún no publica el instalador nativo de esta Mac."
                return
            }
            let current = currentInstallerVersion()
            installerUpdateText = compare(index.installer_version, current) > 0
                ? "Actualización del instalador disponible: \(index.installer_version) (actual \(current))"
                : "Instalador actualizado · \(current)"
        } catch {
            installerUpdateText = "Release histórico: no publica autoactualizador todavía."
        }
    }

    private func loadDistributionIndex(_ release: GitHubRelease, productVersion: String) async throws -> DistributionIndex {
        guard let asset = release.assets.first(where: { $0.name == "treseko-installer-release.json" }),
              let url = URL(string: asset.browser_download_url), url.scheme == "https", url.host == "github.com" else {
            throw InstallerError.message("Este release aún no incluye el índice de distribución.")
        }
        let data = try await fetch(url, timeout: 20)
        guard data.count <= 1_048_576 else { throw InstallerError.message("El índice de distribución excede el tamaño permitido.") }
        let index = try JSONDecoder().decode(DistributionIndex.self, from: data)
        guard index.schema == 1, index.product == "treseko-platform", index.product_version == productVersion else {
            throw InstallerError.message("El índice no coincide con el release oficial.")
        }
        guard validVersion(index.installer_version), !index.artifacts.isEmpty else {
            throw InstallerError.message("El índice no declara una versión válida ni artefactos.")
        }
        for artifact in index.artifacts.values {
            guard let published = release.assets.first(where: { $0.name == artifact.name }),
                  published.size == artifact.size, artifact.size > 0,
                  artifact.sha256.range(of: #"^[a-fA-F0-9]{64}$"#, options: .regularExpression) != nil else {
                throw InstallerError.message("El índice y los assets de GitHub no coinciden.")
            }
        }
        return index
    }

    private func obtainPackage(_ release: GitHubRelease) async throws -> URL {
        let cache = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".cache/treseko/packages", isDirectory: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        let tag = release.tag_name
        let target = cache.appendingPathComponent(tag, isDirectory: true)
        if isValidPackage(target) { return target }
        let archive: URL
        if release.assets.contains(where: { $0.name == "treseko-installer-release.json" }) {
            let index = try await loadDistributionIndex(release, productVersion: releaseVersion ?? "")
            guard let packageAsset = index.artifacts["community-package"] else {
                throw InstallerError.message("El índice oficial no publica el paquete de instalación.")
            }
            let asset = try asset(named: packageAsset.name, in: release)
            let destination = cache.appendingPathComponent(packageAsset.name)
            try await downloadVerified(asset, expectedSize: packageAsset.size, expectedSHA256: packageAsset.sha256, to: destination)
            archive = destination
        } else {
            guard let url = URL(string: release.zipball_url), url.host == "api.github.com" else {
                throw InstallerError.message("El release no ofrece un paquete Community válido.")
            }
            let (download, response) = try await URLSession.shared.download(from: url)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) == true else {
                throw InstallerError.message("No se pudo descargar el paquete del release.")
            }
            archive = download
        }
        let staging = cache.appendingPathComponent(".staging-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: staging) }
        let unzip = try await run("/usr/bin/ditto", arguments: ["-x", "-k", archive.path, staging.path], currentDirectory: staging)
        _ = unzip
        guard let package = findPackageRoot(staging), isValidPackage(package) else {
            throw InstallerError.message("El release descargado no contiene un paquete Treseko válido.")
        }
        do {
            try FileManager.default.moveItem(at: package, to: target)
        } catch {
            if !isValidPackage(target) { throw error }
        }
        return target
    }

    private func validatePackage(_ root: URL, expectedVersion: String) throws {
        guard isValidPackage(root), try String(contentsOf: root.appendingPathComponent("VERSION"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) == expectedVersion else {
            throw InstallerError.message("El paquete descargado no coincide con la versión esperada.")
        }
    }

    private func isValidPackage(_ root: URL) -> Bool {
        FileManager.default.fileExists(atPath: root.appendingPathComponent("VERSION").path)
            && FileManager.default.fileExists(atPath: root.appendingPathComponent("docker-compose.prod.yml").path)
            && FileManager.default.fileExists(atPath: root.appendingPathComponent("scripts/install_local_treseko.sh").path)
    }

    private func findPackageRoot(_ root: URL) -> URL? {
        if isValidPackage(root) { return root }
        guard let children = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey]) else { return nil }
        return children.first(where: { isValidPackage($0) })
    }

    private func findCachedInstallation() -> URL? {
        let cache = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".cache/treseko/packages", isDirectory: true)
        guard let entries = try? FileManager.default.contentsOfDirectory(at: cache, includingPropertiesForKeys: [.contentModificationDateKey]) else { return nil }
        return entries.sorted {
            let a = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let b = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return a > b
        }.first(where: { isRecognizedInstallation($0) })
    }

    private func isRecognizedInstallation(_ root: URL) -> Bool {
        let names = ["db-password", "database-url", "secret-key", "ai-credentials-master-key", "ai-engine-internal-token", "admin-password"]
        return FileManager.default.fileExists(atPath: root.appendingPathComponent("compose.production.env").path)
            && FileManager.default.fileExists(atPath: root.appendingPathComponent("docker-compose.prod.yml").path)
            && names.allSatisfy { FileManager.default.fileExists(atPath: root.appendingPathComponent(".treseko-local/secrets/\($0)").path) }
    }

    private func recordedVersion(_ root: URL) -> String? {
        let active = root.appendingPathComponent(".treseko-local/active-release.json")
        if let data = try? Data(contentsOf: active), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let version = object["version"] as? String { return version }
        return try? String(contentsOf: root.appendingPathComponent("VERSION"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func hasUnfinishedUpdate(_ root: URL) -> Bool {
        let journalRoot = root.appendingPathComponent(".treseko-local/update-transactions", isDirectory: true)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: journalRoot.path, isDirectory: &isDirectory) else { return false }
        guard isDirectory.boolValue else { return true }
        let terminal: Set<String> = ["committed", "rolled_back", "abandoned_before_mutation", "candidate_rejected"]
        guard let files = try? FileManager.default.contentsOfDirectory(at: journalRoot, includingPropertiesForKeys: [.isRegularFileKey]) else { return true }
        for file in files where file.pathExtension == "json" {
            guard let data = try? Data(contentsOf: file),
                  let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let phase = value["phase"] as? String, terminal.contains(phase) else { return true }
        }
        return false
    }

    private func runtimeMatchesInstallation(port: Int, root: URL) async throws -> Bool {
        let docker = ["/opt/homebrew/bin/docker", "/usr/local/bin/docker", "/usr/bin/docker"].first {
            FileManager.default.isExecutableFile(atPath: $0)
        } ?? "/usr/bin/env"
        let dockerArguments = docker == "/usr/bin/env" ? ["docker"] : []
        let listed = try await run(docker, arguments: dockerArguments + ["ps", "--filter", "publish=\(port)", "--format", "{{.ID}}"], currentDirectory: root)
        let identifiers = listed.split(whereSeparator: \.isNewline).map(String.init)
        guard identifiers.count == 1 else { return false }
        let inspected = try await run(docker, arguments: dockerArguments + ["inspect", "--format={{json .Config.Labels}}", identifiers[0]], currentDirectory: root)
        guard let labels = try JSONSerialization.jsonObject(with: Data(inspected.utf8)) as? [String: String],
              labels["com.docker.compose.service"] == "frontend" else { return false }
        var expectedRoots: Set<String> = [root.standardizedFileURL.path]
        let activePath = root.appendingPathComponent(".treseko-local/active-release.json")
        if let data = try? Data(contentsOf: activePath),
           let active = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let relative = active["release"] as? String,
           !relative.hasPrefix("/"), !relative.split(separator: "/").contains("..") {
            expectedRoots.insert(root.appendingPathComponent(".treseko-local/releases/\(relative)").standardizedFileURL.path)
        }
        var observedRoots: Set<String> = []
        if let working = labels["com.docker.compose.project.working_dir"] { observedRoots.insert(URL(fileURLWithPath: working).standardizedFileURL.path) }
        for file in (labels["com.docker.compose.project.config_files"] ?? "").split(separator: ",") {
            observedRoots.insert(URL(fileURLWithPath: String(file).trimmingCharacters(in: .whitespacesAndNewlines)).deletingLastPathComponent().standardizedFileURL.path)
        }
        return !expectedRoots.isDisjoint(with: observedRoots)
    }

    private func updateAvailableMode() {
        if let runtime, runtime.state == "running" { mode = "update" }
        else if let runtime, runtime.state != "not_running" { mode = "blocked" }
        else if !installRoot.isEmpty && isRecognizedInstallation(URL(fileURLWithPath: installRoot)) { mode = "update" }
        else { mode = "new" }
    }

    private func currentInstallerVersion() -> String {
        if let value = Bundle.main.object(forInfoDictionaryKey: "TresekoInstallerVersion") as? String { return value }
        return "0.0.0"
    }

    private func asset(named name: String, in release: GitHubRelease) throws -> GitHubRelease.Asset {
        guard let row = release.assets.first(where: { $0.name == name }),
              let url = URL(string: row.browser_download_url), url.scheme == "https", url.host == "github.com" else {
            throw InstallerError.message("GitHub no publicó el artefacto solicitado en este release.")
        }
        return row
    }

    private func downloadVerified(_ asset: GitHubRelease.Asset, expectedSize: Int, expectedSHA256: String, to destination: URL) async throws {
        let (temporary, response) = try await URLSession.shared.download(from: URL(string: asset.browser_download_url)!)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let finalURL = http.url, finalURL.host == "release-assets.githubusercontent.com" || finalURL.host == "github.com" else {
            throw InstallerError.message("La descarga del instalador no vino de GitHub.")
        }
        let values = try temporary.resourceValues(forKeys: [.fileSizeKey])
        guard expectedSize > 0, values.fileSize == expectedSize,
              let data = try? Data(contentsOf: temporary, options: .mappedIfSafe),
              SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == expectedSHA256.lowercased() else {
            throw InstallerError.message("La integridad SHA-256 del artefacto no coincide.")
        }
        let staged = destination.appendingPathExtension("staged")
        try? FileManager.default.removeItem(at: staged)
        try FileManager.default.copyItem(at: temporary, to: staged)
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.moveItem(at: staged, to: destination)
    }

    private func launchBundleReplacement(archive: URL, stageRoot: URL) throws {
        guard isRunningFromAppBundle, FileManager.default.isWritableFile(atPath: currentBundle.deletingLastPathComponent().path) else {
            throw InstallerError.message("Para autoactualizar, mové Treseko Installer a una carpeta de usuario escribible, como ~/Applications.")
        }
        let script = stageRoot.appendingPathComponent("replace-installer.sh")
        let appPath = currentBundle.path
        let archivePath = archive.path
        let replacement = """
        #!/bin/sh
        set -eu
        pid=$1; current=$2; archive=$3; stage=$4
        while kill -0 "$pid" 2>/dev/null; do sleep 0.4; done
        /usr/bin/ditto -x -k "$archive" "$stage"
        candidate=$(find "$stage" -maxdepth 2 -name '*.app' -type d -print -quit)
        [ -n "$candidate" ] || exit 21
        backup="${current}.backup.$pid"
        mv "$current" "$backup"
        if mv "$candidate" "$current"; then
          /usr/bin/open "$current" || { mv "$current" "${current}.failed.$pid"; mv "$backup" "$current"; /usr/bin/open "$current"; exit 22; }
        else
          mv "$backup" "$current"
          /usr/bin/open "$current"
          exit 23
        fi
        """
        try replacement.write(to: script, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path, String(ProcessInfo.processInfo.processIdentifier), appPath, archivePath, stageRoot.path]
        try process.run()
    }

    private func fetch(_ url: URL, timeout: TimeInterval) async throws -> Data {
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.setValue("Treseko-Installer-macOS", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let finalURL = http.url, finalURL.scheme == "https",
              ["github.com", "api.github.com", "release-assets.githubusercontent.com"].contains(finalURL.host ?? "") else {
            throw InstallerError.message("La respuesta fue redirigida fuera de GitHub o no fue válida.")
        }
        return data
    }

    private func run(_ executable: String, arguments: [String], currentDirectory: URL) async throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.currentDirectoryURL = currentDirectory
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        try process.run()
        return try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { process in
                let data = output.fileHandleForReading.readDataToEndOfFile()
                let text = String(data: data, encoding: .utf8) ?? ""
                if process.terminationStatus == 0 { continuation.resume(returning: text) }
                else { continuation.resume(throwing: InstallerError.message(text.isEmpty ? "El comando terminó con código \(process.terminationStatus)." : text)) }
            }
        }
    }

    private func compare(_ left: String, _ right: String) -> Int {
        guard let lhs = semver(left), let rhs = semver(right) else { return 0 }
        for i in 0..<3 where lhs.core[i] != rhs.core[i] { return lhs.core[i] > rhs.core[i] ? 1 : -1 }
        switch (lhs.prerelease, rhs.prerelease) {
        case (nil, nil): return 0
        case (nil, .some): return 1
        case (.some, nil): return -1
        case let (.some(a), .some(b)):
            for (leftPart, rightPart) in zip(a, b) where leftPart != rightPart {
                let leftNumber = Int(leftPart), rightNumber = Int(rightPart)
                if let leftNumber, let rightNumber { return leftNumber > rightNumber ? 1 : -1 }
                if leftNumber != nil { return -1 }
                if rightNumber != nil { return 1 }
                return leftPart > rightPart ? 1 : -1
            }
            return a.count == b.count ? 0 : (a.count > b.count ? 1 : -1)
        }
    }

    private func semver(_ value: String) -> (core: [Int], prerelease: [String]?)? {
        guard value.range(of: #"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"#, options: .regularExpression) != nil else { return nil }
        let withoutBuild = value.split(separator: "+", maxSplits: 1).first.map(String.init) ?? value
        let segments = withoutBuild.split(separator: "-", maxSplits: 1).map(String.init)
        let core = segments[0].split(separator: ".").compactMap { Int($0) }
        guard core.count == 3 else { return nil }
        let prerelease = segments.count == 2 ? segments[1].split(separator: ".").map(String.init) : nil
        return (core, prerelease)
    }

    private func validVersion(_ value: String) -> Bool {
        semver(value) != nil
    }

    static var macosArtifactKey: String {
        #if arch(arm64)
        "macos-arm64"
        #else
        "macos-x64"
        #endif
    }
}

enum InstallerError: Error {
    case message(String)
    var localizedDescription: String {
        if case let .message(value) = self { return value }
        return "Error del instalador."
    }
}

struct InstallerView: View {
    @StateObject private var model = InstallerModel()
    @State private var showLog = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                Image(systemName: "shippingbox.fill").font(.system(size: 34)).foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Treseko Community").font(.largeTitle.bold())
                    Text("Instalador nativo para macOS").foregroundStyle(.secondary)
                }
            }
            GroupBox("Versiones y estado") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.latestVersion)
                    Text(model.runtimeText).foregroundStyle(model.mode == "blocked" ? .red : .secondary)
                    if !model.installerUpdateText.isEmpty { Text(model.installerUpdateText).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
            }
            GroupBox("Instalación") {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Puerto local")
                        TextField("9095", text: $model.port).frame(width: 90)
                            .onSubmit { model.refresh() }
                        Button("Comprobar") { model.refresh() }
                    }
                    HStack {
                        Text("Raíz existente").frame(width: 125, alignment: .leading)
                        Text(model.installRoot.isEmpty ? "No seleccionada" : model.installRoot).lineLimit(1).truncationMode(.middle)
                        Button("Elegir…") { model.chooseInstallation() }
                    }
                    HStack {
                        Label(model.mode == "update" ? "Actualizar instalación existente" : "Instalar en un destino nuevo", systemImage: model.mode == "update" ? "arrow.triangle.2.circlepath" : "plus.app")
                        Spacer()
                        Text(model.latestVersion.replacingOccurrences(of: "Última versión pública: ", with: "")).font(.callout.monospaced()).foregroundStyle(.secondary)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
            }
            HStack {
                Button("Actualizar instalador") { model.updateInstaller() }
                    .disabled(model.isWorking || !model.installerUpdateText.contains("disponible"))
                Spacer()
                Button(model.isWorking ? "Trabajando…" : model.mode == "update" ? "Actualizar Treseko" : "Instalar Treseko") {
                    model.installOrUpdate()
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isWorking || model.mode == "blocked" || model.latestVersion.hasPrefix("No se pudo"))
            }
            Text(model.activity).font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            DisclosureGroup("Detalles", isExpanded: $showLog) {
                Text("Las descargas se limitan al repositorio público oficial de Treseko. Los artefactos del instalador se validan con SHA-256 antes de reemplazar la aplicación.")
                    .font(.caption).foregroundStyle(.secondary).padding(.top, 6)
            }
            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(minWidth: 680, minHeight: 490)
        .onAppear { model.refresh() }
    }
}

@main
struct TresekoInstallerApp: App {
    var body: some Scene {
        WindowGroup { InstallerView() }
            .windowResizability(.contentSize)
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
