import AppKit
import CryptoKit
import Foundation
import SwiftUI

private let repository = "treseko/treseko-platform"
private let releasesURL = URL(string: "https://api.github.com/repos/treseko/treseko-platform/releases/latest")!
private let productVersionPattern = #"^treseko-community-v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$"#
private func currentInstallerLanguage() -> String {
    let override = ProcessInfo.processInfo.environment["TRESEKO_INSTALLER_LANGUAGE"]?.lowercased()
    if override == "en" || override == "es" { return override! }
    let preference = UserDefaults.standard.string(forKey: "installerLanguage")
    if preference == "en" || preference == "es" { return preference! }
    return Locale.preferredLanguages.first?.hasPrefix("en") == true ? "en" : "es"
}

private func tr(_ spanish: String, _ english: String) -> String {
    currentInstallerLanguage() == "en" ? english : spanish
}

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
        case "running": return tr("Treseko en ejecución · Frontend y Backend \(frontendVersion ?? "?")", "Treseko is running · Frontend and Backend \(frontendVersion ?? "?")")
        case "version_mismatch": return tr("Versiones distintas · Frontend \(frontendVersion ?? "?") · Backend \(backendVersion ?? "?")", "Version mismatch · Frontend \(frontendVersion ?? "?") · Backend \(backendVersion ?? "?")")
        case "not_running": return tr("No hay una instancia respondiendo en este puerto", "No instance is responding on this port")
        default: return tr("Estado ambiguo · no se modificará ninguna instalación", "Unclear status · no installation will be changed")
        }
    }
}

@MainActor
final class InstallerModel: ObservableObject {
    @Published var port = UserDefaults.standard.string(forKey: "tresekoInstallerPort") ?? "9095"
    @Published var shareOnNetwork = false
    @Published var installTarget = "local"
    @Published var sshUser = ""
    @Published var sshHost = ""
    @Published var sshPort = "22"
    @Published var remoteDirectory = "/opt/treseko-platform"
    @Published var installRoot = ""
    @Published var targetRoot = ""
    @Published var latestVersion = tr("Consultando GitHub…", "Checking GitHub…")
    @Published var runtimeText = tr("Comprobando instancia local…", "Checking local installation…")
    @Published var installerUpdateText = ""
    @Published var activity = tr("Listo para consultar Treseko Community.", "Ready to check Treseko Community.")
    @Published var isWorking = false
    @Published var installSucceeded = false
    @Published var operationError: String?
    @Published var initialAdminEmail: String?
    @Published var initialAdminPassword: String?
    @Published var mode = "new"
    private var release: GitHubRelease?
    private var releaseVersion: String?
    private var runtime: RuntimeStatus?

    var currentBundle: URL { Bundle.main.bundleURL.standardizedFileURL }
    var isRunningFromAppBundle: Bool { currentBundle.pathExtension == "app" }
    var hasValidatedRelease: Bool { release != nil && releaseVersion != nil }
    var versionLabel: String { releaseVersion.map { tr("Última versión pública: \($0)", "Latest public version: \($0)") } ?? "" }
    var remoteSSHTarget: String { "\(sshUser.trimmingCharacters(in: .whitespacesAndNewlines))@\(sshHost.trimmingCharacters(in: .whitespacesAndNewlines))" }
    var remoteHostForURL: String { sshHost.trimmingCharacters(in: .whitespacesAndNewlines) }

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
                throw InstallerError.message(tr("GitHub no respondió con un release disponible.", "GitHub did not return an available release."))
            }
            let result = try JSONDecoder().decode(GitHubRelease.self, from: data)
            guard !result.draft, !result.prerelease,
                  let url = URL(string: result.html_url), url.host == "github.com",
                  url.path == "/\(repository)/releases/tag/\(result.tag_name)",
                  let archive = URL(string: result.zipball_url), archive.scheme == "https",
                  archive.host == "api.github.com",
                  let match = result.tag_name.range(of: productVersionPattern, options: .regularExpression) else {
                throw InstallerError.message(tr("El release no coincide con el repositorio oficial o no es estable.", "The release is not from the official repository or is not stable."))
            }
            let version = String(result.tag_name[match]).replacingOccurrences(of: "treseko-community-v", with: "")
            release = result
            releaseVersion = version
            latestVersion = tr("Última versión pública: \(version)", "Latest public version: \(version)")
            await inspectInstallerUpdate(result, productVersion: version)
            if installRoot.isEmpty {
                installRoot = findCachedInstallation()?.path ?? ""
            }
            updateAvailableMode()
        } catch {
            latestVersion = tr("No se pudo consultar GitHub: \(error.localizedDescription)", "Could not check GitHub: \(error.localizedDescription)")
        }
    }

    func inspectRuntime() async {
        guard let portNumber = Int(port), (1...65535).contains(portNumber) else {
            runtime = RuntimeStatus(state: "unknown", frontendVersion: nil, backendVersion: nil)
            runtimeText = tr("Puerto inválido", "Invalid port")
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
                runtimeText = tr("El puerto está ocupado por otro servicio", "The port is in use by another service")
                updateAvailableMode()
                return
            }
            let healthData = try await fetch(base.appendingPathComponent("api/health"), timeout: 3)
            let health = try JSONSerialization.jsonObject(with: healthData) as? [String: Any]
            guard health?["status"] as? String == "ok", let backendVersion = health?["version"] as? String else {
                runtime = RuntimeStatus(state: "unverified", frontendVersion: frontendVersion, backendVersion: nil)
                runtimeText = tr("Treseko responde, pero el Backend no pudo verificarse", "Treseko responds, but the Backend could not be verified")
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
            runtimeText = runtime?.message ?? tr("No se pudo verificar la instancia", "Could not verify the installation")
        }
        updateAvailableMode()
    }

    func chooseInstallation() {
        let panel = NSOpenPanel()
        panel.title = tr("Elegir la raíz de la instalación Treseko", "Choose the Treseko installation folder")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url, isRecognizedInstallation(url) else {
            activity = tr("La carpeta no contiene una instalación reconocible; no se cambió el destino.", "This folder does not contain a recognized installation. The destination was not changed.")
            return
        }
        installRoot = url.path
        refresh()
    }

    func installOrUpdate() {
        guard !isWorking else { return }
        installSucceeded = false
        operationError = nil
        initialAdminEmail = nil
        initialAdminPassword = nil
        Task { await performInstallOrUpdate() }
    }

    func copyInitialAdminPassword() {
        guard let initialAdminPassword else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(initialAdminPassword, forType: .string)
    }

    private func summaryValue(_ label: String, in output: String) -> String? {
        let lines = output.components(separatedBy: .newlines)
        guard let index = lines.firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == label }),
              lines.indices.contains(index + 1) else { return nil }
        let value = lines[index + 1].trimmingCharacters(in: .whitespaces)
        return value.isEmpty ? nil : value
    }

    private func prepareComposeBindAddressCompatibility(in package: URL) throws {
        let compose = package.appendingPathComponent("docker-compose.prod.yml")
        let values = try compose.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              compose.deletingLastPathComponent().standardizedFileURL == package.standardizedFileURL else {
            throw InstallerError.message(tr("No se puede ajustar de forma segura el puerto del paquete descargado.", "The downloaded package port mapping cannot be adjusted safely."))
        }
        let content = try String(contentsOf: compose, encoding: .utf8)
        let legacy = "      - \"${TRESEKO_HTTP_PORT:-9095}:80\""
        let compatible = "      - \"${TRESEKO_BIND_ADDRESS:-127.0.0.1}:${TRESEKO_HTTP_PORT:-9095}:80\""
        if content.contains(compatible) { return }
        guard content.components(separatedBy: legacy).count == 2 else {
            throw InstallerError.message(tr("El paquete no permite fijar de forma segura la dirección de escucha; no se iniciará la instalación.", "The package does not support safely restricting its listening address; installation will not start."))
        }
        try content.replacingOccurrences(of: legacy, with: compatible).write(to: compose, atomically: true, encoding: .utf8)
    }

    private func persistComposeBindAddress(_ bindAddress: String, in package: URL) throws {
        guard ["127.0.0.1", "0.0.0.0"].contains(bindAddress) else {
            throw InstallerError.message(tr("La dirección de escucha seleccionada no es válida.", "The selected listening address is invalid."))
        }
        let envFile = package.appendingPathComponent("compose.production.env")
        let values = try envFile.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              envFile.deletingLastPathComponent().standardizedFileURL == package.standardizedFileURL else {
            throw InstallerError.message(tr("No se puede guardar de forma segura la dirección de escucha.", "The listening address cannot be saved safely."))
        }
        let content = try String(contentsOf: envFile, encoding: .utf8)
        var lines = content.components(separatedBy: .newlines)
        if lines.last == "" { lines.removeLast() }
        let matches = lines.indices.filter { lines[$0].hasPrefix("TRESEKO_BIND_ADDRESS=") }
        guard matches.count <= 1 else {
            throw InstallerError.message(tr("El archivo de configuración contiene más de una dirección de escucha.", "The configuration file contains more than one listening address."))
        }
        let setting = "TRESEKO_BIND_ADDRESS=\(bindAddress)"
        if let index = matches.first {
            if lines[index] == setting { return }
            lines[index] = setting
        } else {
            lines.append(setting)
        }
        try (lines.joined(separator: "\n") + "\n").write(to: envFile, atomically: true, encoding: .utf8)
    }

    func openTreseko() {
        let host = installTarget == "remote" ? remoteHostForURL : "localhost"
        guard let portNumber = Int(port), (1...65535).contains(portNumber),
              let url = URL(string: "http://\(host):\(portNumber)") else { return }
        NSWorkspace.shared.open(url)
    }

    func chooseInstallTarget(_ target: String) {
        installTarget = target
        if target == "remote" {
            mode = "remote"
        } else {
            updateAvailableMode()
        }
    }

    func updateInstaller() {
        guard !isWorking else { return }
        Task { await performInstallerUpdate() }
    }

    private func performInstallOrUpdate() async {
        isWorking = true
        defer { isWorking = false }
        do {
            guard let release, let releaseVersion else { throw InstallerError.message(tr("Primero debe validarse el release de GitHub.", "Validate the GitHub release first.")) }
            if installTarget == "remote" {
                guard mode == "remote" else { throw InstallerError.message(tr("La instalación remota requiere un destino nuevo.", "Remote installation requires a new destination.")) }
                guard sshUser.range(of: #"^[A-Za-z_][A-Za-z0-9_.-]*$"#, options: .regularExpression) != nil,
                      sshHost.range(of: #"^[A-Za-z0-9][A-Za-z0-9.-]*$"#, options: .regularExpression) != nil else {
                    throw InstallerError.message(tr("Indica un usuario SSH válido y el nombre o IP del servidor Linux.", "Enter a valid SSH username and the Linux server name or IP address."))
                }
                guard let sshPortNumber = Int(sshPort), (1...65535).contains(sshPortNumber) else {
                    throw InstallerError.message(tr("El puerto SSH debe ser un número entre 1 y 65535.", "SSH port must be a number between 1 and 65535."))
                }
                guard remoteDirectory.hasPrefix("/"), !remoteDirectory.contains("\n") else {
                    throw InstallerError.message(tr("La carpeta remota debe ser una ruta absoluta de Linux.", "The remote folder must be an absolute Linux path."))
                }
                guard remoteDirectory.range(of: #"^/[A-Za-z0-9._/-]+$"#, options: .regularExpression) != nil,
                      remoteDirectory != "/",
                      !remoteDirectory.split(separator: "/").contains("..") else {
                    throw InstallerError.message(tr("Usa una carpeta remota segura, por ejemplo /opt/treseko-platform.", "Use a safe remote folder, for example /opt/treseko-platform."))
                }
                guard let httpPort = Int(port), (1...65535).contains(httpPort) else {
                    throw InstallerError.message(tr("El puerto HTTP debe ser un número entre 1 y 65535.", "HTTP port must be a number between 1 and 65535."))
                }
                mode = "remote"
                let package = try await obtainPackage(release)
                try validatePackage(package, expectedVersion: releaseVersion)
                let script = package.appendingPathComponent("scripts/install_remote_treseko.sh")
                guard FileManager.default.fileExists(atPath: script.path) else {
                    throw InstallerError.message(tr("El paquete no incluye el instalador remoto por SSH.", "The package does not include the remote SSH installer."))
                }
                activity = tr("Validando SSH, permisos y destino en \(remoteSSHTarget)…", "Checking SSH, permissions, and destination on \(remoteSSHTarget)…")
                let destinationCheck = "test ! -e '\(remoteDirectory)' && { [ \"$(id -u)\" = 0 ] || (command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1); } && { command -v docker >/dev/null 2>&1 || command -v apt-get >/dev/null 2>&1; }"
                do {
                    _ = try await run("/usr/bin/ssh", arguments: ["-o", "BatchMode=yes", "-p", String(sshPortNumber), remoteSSHTarget, destinationCheck], currentDirectory: package)
                } catch {
                    throw InstallerError.message(tr("No se pudo validar el servidor. Revisa la clave SSH, known_hosts, sudo sin interacción y que \(remoteDirectory) todavía no exista. Detalle: \(error.localizedDescription)", "Could not validate the server. Check your SSH key, known_hosts, non-interactive sudo, and that \(remoteDirectory) does not exist yet. Details: \(error.localizedDescription)"))
                }
                let arguments = [script.path, remoteSSHTarget, "--ssh-port", String(sshPortNumber), "--remote-dir", remoteDirectory, "--http-port", String(httpPort)]
                activity = tr("Conectando por SSH e instalando Treseko en \(remoteSSHTarget)…", "Connecting over SSH and installing Treseko on \(remoteSSHTarget)…")
                let output = try await run("/bin/bash", arguments: arguments, currentDirectory: package)
                guard output.contains("Treseko Community quedo instalado.") else {
                    throw InstallerError.message(output.isEmpty ? tr("El instalador remoto no confirmó que Treseko quedó instalado.", "The remote installer did not confirm that Treseko was installed.") : output)
                }
                initialAdminEmail = summaryValue("Usuario inicial:", in: output)
                initialAdminPassword = summaryValue("Contraseña temporal:", in: output)
                guard initialAdminEmail != nil, initialAdminPassword != nil else {
                    throw InstallerError.message(tr("La instalación terminó, pero no se pudo recuperar la contraseña inicial. Revisa la salida del instalador remoto.", "Installation finished, but the initial password could not be recovered. Check the remote installer output."))
                }
                activity = tr("Instalación remota terminada. Preparando las credenciales iniciales…", "Remote installation finished. Preparing the initial credentials…")
                installSucceeded = true
                return
            }
            await inspectRuntime()
            guard let runtime else { throw InstallerError.message(tr("No se pudo determinar el estado de la instalación.", "Could not determine the installation status.")) }
            let isRecognized = isRecognizedInstallation(URL(fileURLWithPath: installRoot))
            if runtime.state == "version_mismatch" || runtime.state == "occupied" || runtime.state == "unknown" || runtime.state == "unverified" {
                throw InstallerError.message(tr("La instancia es ambigua o no está saludable. No se iniciará la instalación.", "The instance is ambiguous or unhealthy. Installation will not start."))
            }
            if runtime.state == "running" && !isRecognized {
                throw InstallerError.message(tr("Treseko está activo, pero su raíz no está seleccionada. Elegí la instalación correcta antes de actualizar.", "Treseko is running, but its installation folder is not selected. Choose the correct installation before updating."))
            }
            if runtime.state == "running" {
                guard try await runtimeMatchesInstallation(port: Int(port)!, root: URL(fileURLWithPath: installRoot)) else {
                    throw InstallerError.message(tr("Docker no pudo vincular el servicio activo con la raíz seleccionada.", "Docker could not match the running service to the selected installation folder."))
                }
            }
            if isRecognized && hasUnfinishedUpdate(URL(fileURLWithPath: installRoot)) {
                throw InstallerError.message(tr("Hay una transacción de actualización pendiente o interrumpida. No se iniciará otra.", "An update transaction is pending or interrupted. Another update will not start."))
            }
            if runtime.state == "running", let current = runtime.frontendVersion,
               compare(releaseVersion, current) <= 0 {
                throw InstallerError.message(tr("La versión disponible (\(releaseVersion)) no es posterior a la instalada (\(current)).", "The available version (\(releaseVersion)) is not newer than the installed version (\(current))."))
            }
            if runtime.state == "not_running", isRecognized,
               let current = recordedVersion(URL(fileURLWithPath: installRoot)), compare(releaseVersion, current) <= 0 {
                throw InstallerError.message(tr("La versión destino no es más nueva que la última versión registrada (\(current)).", "The target version is not newer than the last recorded version (\(current))."))
            }
            mode = isRecognized ? "update" : "new"
            let package = try await obtainPackage(release)
            try validatePackage(package, expectedVersion: releaseVersion)
            if mode == "new" && isRecognized { throw InstallerError.message(tr("Ya hay una instalación en la raíz elegida; seleccioná Actualizar.", "An installation already exists in the selected folder; choose Update.")) }
            let script = package.appendingPathComponent("scripts/install_local_treseko.sh")
            if mode == "new" { try prepareComposeBindAddressCompatibility(in: package) }
            var arguments = [script.path, "--http-port", port]
            if mode == "update" {
                guard let root = installRoot.nilIfEmpty else { throw InstallerError.message(tr("Seleccioná la raíz de la instalación existente.", "Select the existing installation folder.")) }
                arguments.append(contentsOf: ["--update", "--install-root", root])
            }
            activity = tr("Instalando Treseko \(releaseVersion)…", "Installing Treseko \(releaseVersion)…")
            let bindAddress = shareOnNetwork ? "0.0.0.0" : "127.0.0.1"
            let output = try await run("/bin/bash", arguments: arguments, currentDirectory: package, environment: mode == "new" ? ["TRESEKO_BIND_ADDRESS": bindAddress] : nil)
            var bindAddressPersistenceWarning: String?
            if mode == "new" {
                do {
                    try persistComposeBindAddress(bindAddress, in: package)
                } catch {
                    bindAddressPersistenceWarning = tr("La instalación terminó; no se pudo guardar la dirección de escucha: \(error.localizedDescription)", "Installation finished; the listening address could not be saved: \(error.localizedDescription)")
                }
            }
            activity = tr("Instalación completada. Verificando servicios…", "Installation complete. Verifying services…")
            await inspectRuntime()
            guard self.runtime?.state == "running", self.runtime?.frontendVersion == releaseVersion else {
                throw InstallerError.message(tr("La instalación terminó, pero Frontend y Backend no confirmaron \(releaseVersion).", "Installation finished, but Frontend and Backend did not confirm version \(releaseVersion)."))
            }
            if mode == "new" {
                let passwordPath = package.appendingPathComponent(".treseko-local/secrets/admin-password")
                let password = try String(contentsOf: passwordPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !password.isEmpty else {
                    throw InstallerError.message(tr("Treseko se instaló, pero no se encontró la contraseña inicial para mostrarla.", "Treseko was installed, but the initial password could not be found to display it."))
                }
                initialAdminEmail = summaryValue("Usuario inicial:", in: output) ?? "admin@qa.local"
                initialAdminPassword = password
            }
            activity = bindAddressPersistenceWarning ?? tr("Treseko \(releaseVersion) quedó instalado y verificado.", "Treseko \(releaseVersion) was installed and verified.")
            installSucceeded = true
        } catch {
            operationError = error.localizedDescription
            activity = tr("No se completó la operación: \(error.localizedDescription)", "Operation did not complete: \(error.localizedDescription)")
        }
    }

    private func performInstallerUpdate() async {
        isWorking = true
        defer { isWorking = false }
        do {
            guard let release, let version = releaseVersion else { throw InstallerError.message(tr("No hay un release validado.", "No validated release is available.")) }
            let index = try await loadDistributionIndex(release, productVersion: version)
            let key = Self.macosArtifactKey
            guard let entry = index.artifacts[key] else { throw InstallerError.message(tr("El release todavía no incluye un instalador macOS para este equipo.", "The release does not include a macOS installer for this computer yet.")) }
            guard compare(index.installer_version, currentInstallerVersion()) > 0 else {
                throw InstallerError.message(tr("Este instalador ya está actualizado.", "This installer is already up to date."))
            }
            let asset = try asset(named: entry.name, in: release)
            let stageRoot = FileManager.default.temporaryDirectory.appendingPathComponent("treseko-installer-update-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: stageRoot, withIntermediateDirectories: true)
            let archive = stageRoot.appendingPathComponent(entry.name)
            try await downloadVerified(asset, expectedSize: entry.size, expectedSHA256: entry.sha256, to: archive)
            try launchBundleReplacement(archive: archive, stageRoot: stageRoot)
            activity = tr("Instalador verificado. Se cerrará y abrirá la nueva versión.", "Installer verified. The current version will close and the new version will open.")
            NSApp.terminate(nil)
        } catch {
            activity = tr("No se pudo actualizar el instalador: \(error.localizedDescription)", "Could not update the installer: \(error.localizedDescription)")
        }
    }

    private func inspectInstallerUpdate(_ release: GitHubRelease, productVersion: String) async {
        do {
            let index = try await loadDistributionIndex(release, productVersion: productVersion)
            guard index.artifacts[Self.macosArtifactKey] != nil else {
                installerUpdateText = tr("El release aún no publica el instalador nativo de esta Mac.", "The release does not include this Mac's native installer yet.")
                return
            }
            let current = currentInstallerVersion()
            installerUpdateText = compare(index.installer_version, current) > 0
                ? tr("Actualización del instalador disponible: \(index.installer_version) (actual \(current))", "Installer update available: \(index.installer_version) (current \(current))")
                : tr("Instalador actualizado · \(current)", "Installer up to date · \(current)")
        } catch {
            installerUpdateText = tr("Release histórico: no publica autoactualizador todavía.", "Historical release: installer self-updates are not available yet.")
        }
    }

    private func loadDistributionIndex(_ release: GitHubRelease, productVersion: String) async throws -> DistributionIndex {
        guard let asset = release.assets.first(where: { $0.name == "treseko-installer-release.json" }),
              let url = URL(string: asset.browser_download_url), url.scheme == "https", url.host == "github.com" else {
            throw InstallerError.message(tr("Este release aún no incluye el índice de distribución.", "This release does not include a distribution index yet."))
        }
        let data = try await fetch(url, timeout: 20)
        guard data.count <= 1_048_576 else { throw InstallerError.message(tr("El índice de distribución excede el tamaño permitido.", "The distribution index exceeds the allowed size.")) }
        let index = try JSONDecoder().decode(DistributionIndex.self, from: data)
        guard index.schema == 1, index.product == "treseko-platform", index.product_version == productVersion else {
            throw InstallerError.message(tr("El índice no coincide con el release oficial.", "The index does not match the official release."))
        }
        guard validVersion(index.installer_version), !index.artifacts.isEmpty else {
            throw InstallerError.message(tr("El índice no declara una versión válida ni artefactos.", "The index does not declare a valid version and artifacts."))
        }
        for artifact in index.artifacts.values {
            guard let published = release.assets.first(where: { $0.name == artifact.name }),
                  published.size == artifact.size, artifact.size > 0,
                  artifact.sha256.range(of: #"^[a-fA-F0-9]{64}$"#, options: .regularExpression) != nil else {
                throw InstallerError.message(tr("El índice y los assets de GitHub no coinciden.", "The index and GitHub assets do not match."))
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
                throw InstallerError.message(tr("El índice oficial no publica el paquete de instalación.", "The official index does not publish an installation package."))
            }
            let asset = try asset(named: packageAsset.name, in: release)
            let destination = cache.appendingPathComponent(packageAsset.name)
            try await downloadVerified(asset, expectedSize: packageAsset.size, expectedSHA256: packageAsset.sha256, to: destination)
            archive = destination
        } else {
            guard let url = URL(string: release.zipball_url), url.host == "api.github.com" else {
                throw InstallerError.message(tr("El release no ofrece un paquete Community válido.", "The release does not offer a valid Community package."))
            }
            let (download, response) = try await URLSession.shared.download(from: url)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) == true else {
                throw InstallerError.message(tr("No se pudo descargar el paquete del release.", "Could not download the release package."))
            }
            archive = download
        }
        let staging = cache.appendingPathComponent(".staging-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: staging) }
        let unzip = try await run("/usr/bin/ditto", arguments: ["-x", "-k", archive.path, staging.path], currentDirectory: staging)
        _ = unzip
        guard let package = findPackageRoot(staging), isValidPackage(package) else {
            throw InstallerError.message(tr("El release descargado no contiene un paquete Treseko válido.", "The downloaded release does not contain a valid Treseko package."))
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
            throw InstallerError.message(tr("El paquete descargado no coincide con la versión esperada.", "The downloaded package does not match the expected version."))
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
        if installTarget == "remote" {
            mode = "remote"
            return
        }
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
            throw InstallerError.message(tr("GitHub no publicó el artefacto solicitado en este release.", "GitHub did not publish the requested artifact in this release."))
        }
        return row
    }

    private func downloadVerified(_ asset: GitHubRelease.Asset, expectedSize: Int, expectedSHA256: String, to destination: URL) async throws {
        let (temporary, response) = try await URLSession.shared.download(from: URL(string: asset.browser_download_url)!)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let finalURL = http.url, finalURL.host == "release-assets.githubusercontent.com" || finalURL.host == "github.com" else {
            throw InstallerError.message(tr("La descarga del instalador no vino de GitHub.", "The installer download did not come from GitHub."))
        }
        let values = try temporary.resourceValues(forKeys: [.fileSizeKey])
        guard expectedSize > 0, values.fileSize == expectedSize,
              let data = try? Data(contentsOf: temporary, options: .mappedIfSafe),
              SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == expectedSHA256.lowercased() else {
            throw InstallerError.message(tr("La integridad SHA-256 del artefacto no coincide.", "The artifact's SHA-256 checksum does not match."))
        }
        let staged = destination.appendingPathExtension("staged")
        try? FileManager.default.removeItem(at: staged)
        try FileManager.default.copyItem(at: temporary, to: staged)
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.moveItem(at: staged, to: destination)
    }

    private func launchBundleReplacement(archive: URL, stageRoot: URL) throws {
        guard isRunningFromAppBundle, FileManager.default.isWritableFile(atPath: currentBundle.deletingLastPathComponent().path) else {
            throw InstallerError.message(tr("Para autoactualizar, mové Treseko Installer a una carpeta de usuario escribible, como ~/Applications.", "To update automatically, move Treseko Installer to a writable user folder such as ~/Applications."))
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
            throw InstallerError.message(tr("La respuesta fue redirigida fuera de GitHub o no fue válida.", "The response was invalid or redirected away from GitHub."))
        }
        return data
    }

    private func run(_ executable: String, arguments: [String], currentDirectory: URL, environment: [String: String]? = nil) async throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.currentDirectoryURL = currentDirectory
        if let environment {
            process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, override in override }
        }
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        let readHandle = output.fileHandleForReading
        let outputBuffer = ProcessOutputBuffer()
        readHandle.readabilityHandler = { handle in
            outputBuffer.readAvailable(from: handle)
        }
        return try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { terminatedProcess in
                readHandle.readabilityHandler = nil
                let text = outputBuffer.finishReading(from: readHandle)
                if terminatedProcess.terminationStatus == 0 { continuation.resume(returning: text) }
                else { continuation.resume(throwing: InstallerError.message(text.isEmpty ? "El comando terminó con código \(terminatedProcess.terminationStatus)." : text)) }
            }
            do {
                try process.run()
            } catch {
                readHandle.readabilityHandler = nil
                continuation.resume(throwing: error)
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

enum InstallerError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case let .message(value) = self { return value }
        return "Error del instalador."
    }
}

private final class ProcessOutputBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()

    func readAvailable(from handle: FileHandle) {
        lock.lock()
        data.append(handle.availableData)
        lock.unlock()
    }

    func finishReading(from handle: FileHandle) -> String {
        lock.lock()
        defer { lock.unlock() }
        data.append(handle.readDataToEndOfFile())
        return String(data: data, encoding: .utf8) ?? ""
    }
}

struct InstallerView: View {
    @StateObject private var model = InstallerModel()
    @State private var step = 0
    @AppStorage("installerLanguage") private var languagePreference = "auto"

    private var applicationComponents: [(String, String, String)] {
        [
            ("rectangle.3.group.fill", tr("Interfaz web", "Web interface"), tr("La aplicación que vas a usar para gestionar y ejecutar pruebas.", "Manage projects, tests, and results in the web application.")),
            ("network", tr("Backend y API", "Backend and API"), tr("Gestiona usuarios, reglas y comunicación de la plataforma.", "Handles users, business rules, and platform communication."))
        ]
    }
    private var dataComponents: [(String, String, String)] {
        [
            ("externaldrive.fill", tr("Base de datos", "Database"), tr("Guarda tus proyectos, casos y resultados en este equipo.", "Stores your projects, test cases, and results on this computer.")),
            ("arrow.left.arrow.right", "Redis", tr("Coordina tareas internas y colas de trabajo.", "Coordinates internal tasks and job queues."))
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "shippingbox.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 54, height: 54)
                    .background(Color.accentColor.gradient, in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Treseko Community").font(.title2.bold())
                    Text(tr("Instalador para macOS", "Installer for macOS")).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Picker(currentInstallerLanguage() == "en" ? "Language" : "Idioma", selection: $languagePreference) {
                    Text("Auto").tag("auto")
                    Text("Español").tag("es")
                    Text("English").tag("en")
                }
                .labelsHidden()
                .frame(width: 125)
                if model.hasValidatedRelease {
                    Text(model.versionLabel.replacingOccurrences(of: tr("Última versión pública: ", "Latest public version: "), with: "v"))
                        .font(.caption.weight(.semibold)).padding(.horizontal, 10).padding(.vertical, 6)
                        .background(.quaternary, in: Capsule())
                }
            }
            HStack(spacing: 8) {
                stepMarker(0, title: tr("Destino", "Destination"))
                Rectangle().fill(Color.secondary.opacity(0.2)).frame(height: 1)
                stepMarker(1, title: tr("Componentes", "Components"))
                Rectangle().fill(Color.secondary.opacity(0.2)).frame(height: 1)
                stepMarker(2, title: tr("Confirmar", "Review"))
            }
            .padding(.top, 22)

            if model.isWorking {
                Spacer()
                VStack(spacing: 18) {
                    ProgressView().controlSize(.large)
                    Text(model.mode == "update" ? tr("Actualizando Treseko…", "Updating Treseko…") : (model.installTarget == "remote" ? tr("Instalando Treseko por SSH…", "Installing Treseko over SSH…") : tr("Instalando Treseko…", "Installing Treseko…")))
                        .font(.title3.bold())
                    Text(tr("Esto puede tardar unos minutos. No cierres esta ventana.", "This may take a few minutes. Keep this window open."))
                        .foregroundStyle(.secondary)
                    Text(model.activity).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity)
                Spacer()
            } else if model.installSucceeded {
                Spacer()
                VStack(spacing: 14) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 54)).foregroundStyle(.green)
                    Text(tr("Treseko está listo", "Treseko is ready")).font(.title2.bold())
                    Text(model.installTarget == "remote" ? tr("La instalación terminó en \(model.sshHost). Abrí Treseko para empezar.", "Installation finished on \(model.sshHost). Open Treseko to get started.") : tr("La instalación se verificó correctamente. Abrí Treseko para empezar.", "Installation was verified. Open Treseko to get started."))
                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                    if let email = model.initialAdminEmail, let password = model.initialAdminPassword {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(tr("Credenciales iniciales", "Initial credentials")).font(.headline)
                            Text(tr("Usuario: \(email)", "Username: \(email)")).font(.callout)
                            HStack {
                                Text(password).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                                    .accessibilityLabel(tr("Contraseña temporal", "Temporary password"))
                                Spacer(minLength: 8)
                                Button(tr("Copiar", "Copy")) { model.copyInitialAdminPassword() }
                            }
                            Text(tr("Guárdala ahora; Treseko pedirá cambiarla en el primer acceso.", "Save it now; Treseko will ask you to change it on first sign-in."))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(14)
                        .frame(maxWidth: 460, alignment: .leading)
                        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
                    }
                    Button(tr("Abrir Treseko", "Open Treseko")) { model.openTreseko() }
                        .buttonStyle(.borderedProminent).controlSize(.large).padding(.top, 6)
                }.frame(maxWidth: .infinity)
                Spacer()
            } else if step == 0 {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(tr("¿Dónde instalar Treseko?", "Where should Treseko be installed?")).font(.title2.bold())
                        Text(tr("Elegí el equipo que alojará la aplicación y los servicios base.", "Choose the computer that will host the application and core services."))
                            .foregroundStyle(.secondary)
                    }
                    Button { model.chooseInstallTarget("local") } label: {
                        destinationCard(
                            title: tr("Esta Mac", "This Mac"),
                            detail: tr("Instala aquí la aplicación, PostgreSQL, Redis, Engine y Worker.", "Install the application, PostgreSQL, Redis, Engine, and Worker here."),
                            selected: model.installTarget == "local",
                            badge: tr("Recomendado", "Recommended")
                        )
                    }.buttonStyle(.plain)
                    Button { model.chooseInstallTarget("remote") } label: {
                        destinationCard(
                            title: tr("Otro equipo por SSH", "Another computer over SSH"),
                            detail: tr("Instala Treseko completo en un servidor Linux accesible por SSH.", "Install the complete Treseko platform on a Linux server available over SSH."),
                            selected: model.installTarget == "remote",
                            badge: nil
                        )
                    }.buttonStyle(.plain)
                    if model.installTarget == "remote" {
                        GroupBox(tr("Servidor Linux", "Linux server")) {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(spacing: 10) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(tr("Usuario SSH", "SSH username")).font(.caption).foregroundStyle(.secondary)
                                        TextField("ubuntu", text: $model.sshUser)
                                            .textFieldStyle(.roundedBorder)
                                            .accessibilityLabel(tr("Usuario SSH", "SSH username"))
                                    }
                                    Text("@").foregroundStyle(.secondary)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(tr("Servidor o IP", "Server or IP address")).font(.caption).foregroundStyle(.secondary)
                                        TextField("192.168.1.50", text: $model.sshHost)
                                            .textFieldStyle(.roundedBorder)
                                            .accessibilityLabel(tr("Servidor o IP", "Server or IP address"))
                                    }
                                }
                                HStack(spacing: 10) {
                                    Text(tr("Puerto SSH", "SSH port"))
                                    TextField("22", text: $model.sshPort).frame(width: 68).textFieldStyle(.roundedBorder)
                                        .accessibilityLabel(tr("Puerto SSH", "SSH port"))
                                    Spacer()
                                    Text(tr("Puerto Treseko", "Treseko port"))
                                    TextField("9095", text: $model.port).frame(width: 76).textFieldStyle(.roundedBorder)
                                        .accessibilityLabel(tr("Puerto Treseko", "Treseko port"))
                                }
                                TextField(tr("Carpeta de instalación", "Installation folder"), text: $model.remoteDirectory)
                                    .textFieldStyle(.roundedBorder)
                                    .accessibilityLabel(tr("Carpeta de instalación", "Installation folder"))
                                Label(tr("El servidor necesita Linux, SSH y permisos sudo sin interacción o acceso SSH como root. Docker se instalará si falta.", "The server needs Linux, SSH, and non-interactive sudo access, or SSH root access. Docker will be installed if needed."), systemImage: "info.circle")
                                    .font(.caption).foregroundStyle(.secondary)
                                Label(tr("Se usa tu configuración SSH local. No introduzcas la contraseña SSH aquí.", "Your local SSH configuration will be used. Do not enter your SSH password here."), systemImage: "lock.shield")
                                    .font(.caption).foregroundStyle(.secondary)
                                Label(tr("El instalador remoto actual puede exponer secretos temporalmente en la lista de procesos durante la transferencia. Usalo solo en un equipo de confianza.", "The current remote installer may briefly expose secrets in the process list during transfer. Use it only with a trusted computer."), systemImage: "exclamationmark.triangle.fill")
                                    .font(.caption).foregroundStyle(.orange)
                            }.padding(.vertical, 4)
                        }
                    }
                    Spacer(minLength: 0)
                    HStack {
                        Button(tr("Comprobar de nuevo", "Check again")) { model.refresh() }
                            .disabled(model.isWorking)
                        Spacer()
                        Button(tr("Continuar", "Continue")) { withAnimation(.easeInOut(duration: 0.18)) { step = 1 } }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                            .disabled(!model.hasValidatedRelease || (model.installTarget == "remote" && (model.sshUser.isEmpty || model.sshHost.isEmpty)))
                    }
                }.padding(.top, 25)
            } else if step == 1 {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(model.mode == "update" ? tr("Actualizá Treseko", "Update Treseko") : (model.installTarget == "remote" ? tr("Componentes en \(model.sshHost)", "Components on \(model.sshHost)") : tr("Instalá Treseko en este equipo", "Install Treseko on this computer")))
                            .font(.title2.bold())
                        Text(model.mode == "update"
                             ? tr("Se actualizará la aplicación y se conservarán los datos de la instalación seleccionada.", "The application will be updated and the selected installation's data will be preserved.")
                             : tr("Estos componentes se instalarán juntos para que Treseko funcione.", "These components are installed together to run Treseko."))
                            .foregroundStyle(.secondary)
                    }
                    ScrollView {
                        VStack(spacing: 12) {
                            GroupBox(tr("Aplicación", "Application")) {
                                VStack(spacing: 0) {
                                    ForEach(Array(applicationComponents.enumerated()), id: \.offset) { index, component in
                                        componentRow(component)
                                        if index < applicationComponents.count - 1 { Divider().padding(.leading, 42) }
                                    }
                                }.padding(.vertical, 2)
                            }
                            GroupBox(tr("Servicios de datos", "Data services")) {
                                VStack(spacing: 0) {
                                    ForEach(Array(dataComponents.enumerated()), id: \.offset) { index, component in
                                        componentRow(component)
                                        if index < dataComponents.count - 1 { Divider().padding(.leading, 42) }
                                    }
                                }.padding(.vertical, 2)
                            }
                            GroupBox(tr("Complementos Treseko", "Treseko components")) {
                                VStack(spacing: 0) {
                                    componentRow(("sparkles", tr("Motor de IA", "AI Engine"), tr("Se inicia en el equipo destino. El proveedor de IA se configura después.", "Starts on the selected computer. Configure the AI provider later.")))
                                    Divider().padding(.leading, 42)
                                    HStack(alignment: .top, spacing: 12) {
                                        Image(systemName: "play.rectangle.on.rectangle").font(.system(size: 16, weight: .semibold))
                                            .foregroundStyle(Color.accentColor).frame(width: 28, height: 28)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(tr("Worker de automatización", "Automation Worker")).font(.callout.weight(.semibold))
                                            Text(tr("Se instalará y ejecutará en el equipo destino. Después de crear una solución, vinculalo desde Automatización → Workers. Community admite un worker.", "Installs and runs on the selected computer. After creating a solution, pair it from Automation → Workers. Community supports one worker."))
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: "checkmark")
                                            .font(.caption.weight(.bold))
                                            .foregroundStyle(.green)
                                        Text(model.installTarget == "remote" ? tr("Incluido · servidor", "Included · server") : tr("Incluido · esta Mac", "Included · this Mac"))
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.secondary)
                                            .padding(.horizontal, 9).padding(.vertical, 5)
                                            .background(.quaternary, in: Capsule())
                                    }.padding(.vertical, 10)
                                }.padding(.vertical, 2)
                            }
                            GroupBox(tr("También se ejecutará", "Also runs")) {
                                Label(tr("Preparación de la base de datos", "Database setup"), systemImage: "checkmark.seal")
                                    .font(.callout.weight(.semibold))
                                Text(tr("Se realiza una vez durante la instalación para crear o actualizar su estructura.", "Runs once during installation to create or update the database schema."))
                                    .font(.caption).foregroundStyle(.secondary).padding(.leading, 26).padding(.top, 3)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .frame(maxHeight: 380)
                    if model.mode == "blocked" {
                        Label(tr("El puerto predeterminado está ocupado o la instalación necesita revisión. Continuá para cambiar el puerto o seleccionar la carpeta correcta.", "The default port is occupied or the installation needs review. Continue to change the port or select the correct folder."), systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.orange)
                    }
                    HStack {
                        Button(tr("Atrás", "Back")) { withAnimation(.easeInOut(duration: 0.18)) { step = 0 } }
                        Button(tr("Comprobar de nuevo", "Check again")) { model.refresh() }
                            .disabled(model.isWorking)
                        Spacer()
                        Button(tr("Continuar", "Continue")) { withAnimation(.easeInOut(duration: 0.18)) { step = 2 } }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                            .disabled(!model.hasValidatedRelease)
                    }
                }.padding(.top, 25)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    Text(tr("Revisá antes de instalar", "Review before installing")).font(.title2.bold())
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            GroupBox {
                                VStack(alignment: .leading, spacing: 12) {
                                    Label(model.mode == "update" ? tr("Se actualizará la instalación existente", "The existing installation will be updated") : (model.installTarget == "remote" ? tr("Instalación remota por SSH", "Remote installation over SSH") : tr("Instalación nueva en esta Mac", "New installation on this Mac")), systemImage: model.mode == "update" ? "arrow.triangle.2.circlepath" : (model.installTarget == "remote" ? "server.rack" : "plus.app.fill"))
                                        .font(.headline)
                                    if model.installTarget == "remote" {
                                        Label(tr("Destino: \(model.remoteSSHTarget):\(model.sshPort)", "Destination: \(model.remoteSSHTarget):\(model.sshPort)"), systemImage: "desktopcomputer")
                                            .foregroundStyle(.secondary)
                                        Label(tr("Carpeta: \(model.remoteDirectory)", "Folder: \(model.remoteDirectory)"), systemImage: "folder")
                                            .foregroundStyle(.secondary)
                                    }
                                    Label(tr("Aplicación principal: Frontend y Backend/API", "Main application: Frontend and Backend/API"), systemImage: "checkmark.circle.fill")
                                        .foregroundStyle(.secondary)
                                    Label(tr("Servicios base: PostgreSQL y Redis", "Core services: PostgreSQL and Redis"), systemImage: "externaldrive")
                                        .foregroundStyle(.secondary)
                                    Label(model.installTarget == "remote" ? tr("Acceso desde la red del servidor · puerto \(model.port)", "Available on the server network · port \(model.port)") : (model.mode == "update" ? tr("Se conserva el acceso de red actual", "Current network access will be preserved") : (model.shareOnNetwork ? tr("Disponible en la red local", "Available on the local network") : tr("Disponible solo en esta Mac", "Available only on this Mac"))), systemImage: "network")
                                        .foregroundStyle(.secondary)
                                    if model.installTarget == "remote" {
                                        Label(tr("El instalador remoto configura acceso en todas las interfaces del servidor.", "The remote installer enables access on all server interfaces."), systemImage: "exclamationmark.triangle")
                                            .font(.caption).foregroundStyle(.orange)
                                    }
                                    if !model.installRoot.isEmpty {
                                        Text(tr("Instalación: \(model.installRoot)", "Installation: \(model.installRoot)")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
                            }
                            if model.installTarget == "local" {
                            GroupBox(tr("Acceso a Treseko", "Treseko access")) {
                                VStack(alignment: .leading, spacing: 9) {
                                    Picker(tr("Quién puede conectarse", "Who can connect"), selection: $model.shareOnNetwork) {
                                        Text(tr("Solo este equipo", "This computer only")).tag(false)
                                        Text(tr("Red local", "Local network")).tag(true)
                                    }
                                    .pickerStyle(.segmented)
                                    .disabled(model.mode == "update")
                                    Text(model.mode == "update"
                                         ? tr("La actualización conserva el acceso configurado actualmente.", "The update preserves the current access settings.")
                                         : (model.shareOnNetwork
                                            ? tr("Otros equipos de la misma red podrán entrar usando la IP local de esta Mac y el puerto \(model.port). No publiques este puerto directamente en Internet; usa VPN o un proxy HTTPS con firewall.", "Other computers on the same network can connect using this Mac's local IP and port \(model.port). Do not expose this port directly to the Internet; use a VPN or HTTPS proxy with a firewall.")
                                            : tr("Solo esta Mac podrá abrir Treseko en http://localhost:\(model.port).", "Only this Mac can open Treseko at http://localhost:\(model.port).")))
                                        .font(.caption).foregroundStyle(model.mode == "update" || !model.shareOnNetwork ? Color.secondary : Color.orange)
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 3)
                            }
                            }
                            GroupBox(tr("Opciones avanzadas", "Advanced options")) {
                                VStack(alignment: .leading, spacing: 12) {
                                    if model.installTarget == "local" {
                                    HStack {
                                        Text(tr("Dirección local", "Local address")).frame(width: 115, alignment: .leading)
                                        Text("http://localhost:")
                                        TextField("9095", text: $model.port).frame(width: 72)
                                            .onChange(of: model.port) { value in UserDefaults.standard.set(value, forKey: "tresekoInstallerPort") }
                                            .onSubmit { model.refresh() }
                                        Button(tr("Comprobar", "Check")) { model.refresh() }
                                    }
                                    HStack {
                                        Text(tr("Instalación", "Installation")).frame(width: 115, alignment: .leading)
                                        Text(model.installRoot.isEmpty ? tr("Se elegirá automáticamente", "Selected automatically") : model.installRoot)
                                            .lineLimit(1).truncationMode(.middle).foregroundStyle(.secondary)
                                        Button(tr("Elegir…", "Choose…")) { model.chooseInstallation() }
                                    }
                                    }
                                    Divider().padding(.vertical, 4)
                                    Text(tr("Distribuir complementos en otros servidores", "Distribute components across servers"))
                                        .font(.callout.weight(.semibold))
                                    Label(model.installTarget == "remote" ? tr("Worker: se instala en el servidor seleccionado. Community admite un worker.", "Worker: installs on the selected server. Community supports one worker.") : tr("Worker: se instala en esta Mac por defecto. Community admite un worker.", "Worker: installs on this Mac by default. Community supports one worker."), systemImage: "desktopcomputer")
                                        .font(.caption).foregroundStyle(.secondary)
                                    Label(tr("Engine de IA: se inicia localmente. El instalador aún no configura un Engine remoto.", "AI Engine: starts locally. This installer does not configure a remote Engine yet."), systemImage: "sparkles")
                                        .font(.caption).foregroundStyle(.secondary)
                                    Label(tr("PostgreSQL y Redis: no se configuran en servidores remotos desde este asistente.", "PostgreSQL and Redis: this assistant does not configure them on remote servers."), systemImage: "externaldrive")
                                        .font(.caption).foregroundStyle(.secondary)
                                    Link(tr("Guía de despliegue distribuido", "Distributed deployment guide"), destination: URL(string: "https://github.com/treseko/treseko-platform/blob/main/docs/DISTRIBUTED_DEPLOYMENT_GUIDE.md")!)
                                        .font(.caption)
                                    Link(tr("Guía del Worker de automatización", "Automation Worker guide"), destination: URL(string: "https://github.com/treseko/treseko-platform/blob/main/automation-worker/README.md")!)
                                        .font(.caption)
                                }.padding(.vertical, 4)
                            }
                        }
                    }
                    .frame(maxHeight: 380)
                    if let error = model.operationError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                            .textSelection(.enabled)
                    }
                    HStack {
                        Button(tr("Atrás", "Back")) { withAnimation(.easeInOut(duration: 0.18)) { step = 1 } }
                        Spacer()
                        Button(model.mode == "update" ? tr("Actualizar Treseko", "Update Treseko") : tr("Instalar Treseko", "Install Treseko")) { model.installOrUpdate() }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                            .disabled(model.isWorking || (model.installTarget == "local" && model.mode == "blocked") || !model.hasValidatedRelease)
                    }
                }.padding(.top, 25)
            }
            if !model.isWorking && !model.installSucceeded && model.mode == "blocked" {
                Label(tr("El puerto predeterminado está ocupado o encontramos una instalación que no pudimos identificar. Cambiá el puerto o elegí la carpeta correcta en Opciones avanzadas.", "The default port is occupied or an installation could not be identified. Change the port or choose the correct folder in Advanced options."), systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.orange).padding(.top, 12)
            }
        }
        .padding(28)
        .frame(minWidth: 620, idealWidth: 740, maxWidth: 760, minHeight: 700, idealHeight: 760, maxHeight: 780)
        .onAppear { model.refresh() }
    }

    private func stepMarker(_ number: Int, title: String) -> some View {
        HStack(spacing: 7) {
            Text("\(number + 1)").font(.caption.weight(.bold))
                .frame(width: 23, height: 23)
                .background(step >= number ? Color.accentColor : Color.secondary.opacity(0.2), in: Circle())
                .foregroundStyle(step >= number ? .white : .secondary)
            Text(title).font(.caption.weight(step == number ? .semibold : .regular))
                .foregroundStyle(step == number ? .primary : .secondary)
        }
    }

    private func destinationCard(title: String, detail: String, selected: Bool, badge: String?) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                .font(.title3).foregroundStyle(selected ? Color.accentColor : Color.secondary)
                .frame(width: 24, height: 28)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(title).font(.callout.weight(.semibold)).foregroundStyle(.primary)
                    Spacer()
                    if let badge {
                        Text(badge.uppercased()).font(.caption2.weight(.bold))
                            .foregroundStyle(.green).padding(.horizontal, 8).padding(.vertical, 5)
                            .background(.green.opacity(0.12), in: Capsule())
                    }
                }
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? Color.accentColor.opacity(0.10) : Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? Color.accentColor : Color.secondary.opacity(0.18), lineWidth: selected ? 1.5 : 1))
        .contentShape(RoundedRectangle(cornerRadius: 12))
    }

    private func componentRow(_ component: (String, String, String)) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: component.0).font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.accentColor).frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(component.1).font(.callout.weight(.semibold))
                Text(component.2).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(.green)
                .accessibilityLabel(tr("Incluido", "Included"))
        }.padding(.vertical, 10)
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
