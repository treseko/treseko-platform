using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using Microsoft.Win32;

namespace TresekoInstaller;

public partial class MainWindow : Window
{
    private const string LatestApi = "https://api.github.com/repos/treseko/treseko-platform/releases/latest";
    private const string Repository = "treseko/treseko-platform";
    private static readonly string InstallerVersion = Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.0.0";
    private static readonly HttpClient Http = CreateHttpClient();
    private ReleaseInfo? _release;
    private string? _releaseVersion;
    private RuntimeInfo _runtime = new("unknown", null, null);
    private ArtifactInfo? _installerArtifact;
    private bool _canInstall;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await RefreshAsync();
    }

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Treseko-Installer-Windows");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    private async Task RefreshAsync()
    {
        try
        {
            SetBusy(true);
            var response = await Http.GetAsync(LatestApi);
            response.EnsureSuccessStatusCode();
            using var document = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync());
            _release = ParseRelease(document.RootElement);
            _releaseVersion = _release.Version;
            LatestVersionText.Text = $"Última versión pública: {_release.Version}";
            if (string.IsNullOrWhiteSpace(InstallRootInput.Text))
            {
                var cached = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Treseko", "packages");
                if (Directory.Exists(cached))
                    InstallRootInput.Text = Directory.EnumerateDirectories(cached).OrderByDescending(Directory.GetLastWriteTimeUtc).FirstOrDefault(IsRecognized) ?? "";
            }
            await InspectInstallerUpdateAsync(_release);
            _runtime = await DetectRuntimeAsync(ParsePort());
            RuntimeText.Text = _runtime.Message;
            var recognized = IsRecognized(InstallRootInput.Text);
            var rootMatches = _runtime.State != "running" || (recognized && await RuntimeMatchesInstallationAsync(ParsePort(), InstallRootInput.Text));
            var pending = recognized && HasUnfinishedUpdate(InstallRootInput.Text);
            var targetVersion = recognized ? InstalledVersion(InstallRootInput.Text) : null;
            var downgrade = targetVersion is not null && CompareVersions(_release.Version, targetVersion) <= 0;
            var ambiguous = _runtime.State is "occupied" or "unknown" or "unverified" or "version_mismatch";
            var updateAllowed = recognized && rootMatches && !pending && !ambiguous && !downgrade;
            var newAllowed = !recognized && _runtime.State == "not_running";
            _canInstall = updateAllowed || newAllowed;
            InstallButton.IsEnabled = _canInstall;
            InstallButton.Content = updateAllowed ? "Actualizar Treseko" : "Instalar Treseko";
            ModeText.Text = pending
                ? "Hay una transacción pendiente o interrumpida. No se iniciará otra actualización."
                : !rootMatches
                    ? "Docker no pudo asociar la instancia del puerto con la raíz elegida."
                    : downgrade
                        ? $"Se bloquea una versión no posterior a la instalada ({targetVersion})."
                        : ambiguous
                            ? "La instalación es ambigua o está incompleta; no se modificará."
                            : updateAllowed
                                ? $"Instalación reconocida · versión registrada {targetVersion}."
                                : newAllowed
                                    ? "No se detectó una instalación; podés instalar Treseko."
                                    : "Puerto ocupado o instalación no identificada; no se permite instalar encima.";
        }
        catch (Exception ex)
        {
            _canInstall = false;
            LatestVersionText.Text = "No se pudo consultar GitHub.";
            ModeText.Text = ex.Message;
            InstallButton.IsEnabled = false;
        }
        finally { SetBusy(false); }
    }

    private static ReleaseInfo ParseRelease(JsonElement root)
    {
        if (root.GetProperty("draft").GetBoolean() || root.GetProperty("prerelease").GetBoolean()) throw new InvalidDataException("El último release no es estable.");
        var tag = root.GetProperty("tag_name").GetString() ?? "";
        var match = Regex.Match(tag, @"^treseko-community-v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$");
        var html = new Uri(root.GetProperty("html_url").GetString() ?? "");
        var archive = new Uri(root.GetProperty("zipball_url").GetString() ?? "");
        if (!match.Success || html.Scheme != "https" || html.Host != "github.com" || html.AbsolutePath != $"/{Repository}/releases/tag/{tag}" || archive.Scheme != "https" || archive.Host != "api.github.com")
            throw new InvalidDataException("El release no pertenece al repositorio público oficial.");
        var assets = root.GetProperty("assets").EnumerateArray().Select(item => new AssetInfo(
            item.GetProperty("name").GetString() ?? "",
            item.GetProperty("size").GetInt64(),
            new Uri(item.GetProperty("browser_download_url").GetString() ?? ""))).ToArray();
        if (assets.Any(asset => asset.Url.Scheme != "https" || asset.Url.Host != "github.com") || assets.Select(x => x.Name).Distinct().Count() != assets.Length)
            throw new InvalidDataException("El release contiene assets duplicados o URLs no oficiales.");
        return new ReleaseInfo(match.Groups[1].Value, tag, archive, assets);
    }

    private async Task InspectInstallerUpdateAsync(ReleaseInfo release)
    {
        _installerArtifact = null;
        using var index = await LoadDistributionIndexAsync(release);
        if (index is null) { InstallerUpdateText.Text = "Release histórico · aún no publica autoactualización."; SelfUpdateButton.IsEnabled = false; return; }
        var root = index.RootElement;
        var installerVersion = root.GetProperty("installer_version").GetString() ?? "";
        if (!ValidVersion(installerVersion) || CompareVersions(installerVersion, InstallerVersion) <= 0) { InstallerUpdateText.Text = $"Instalador actualizado · {InstallerVersion}"; SelfUpdateButton.IsEnabled = false; return; }
        var artifacts = root.GetProperty("artifacts");
        var target = artifacts.TryGetProperty("windows-x64", out var value) ? value : default;
        if (target.ValueKind != JsonValueKind.Object) { InstallerUpdateText.Text = "No hay autoactualización para Windows x64 en este release."; SelfUpdateButton.IsEnabled = false; return; }
        var name = target.GetProperty("name").GetString() ?? "";
        var size = target.GetProperty("size").GetInt64();
        var hash = target.GetProperty("sha256").GetString() ?? "";
        var published = release.Assets.SingleOrDefault(asset => asset.Name == name);
        if (published is null || published.Size != size || !Regex.IsMatch(hash, "^[a-fA-F0-9]{64}$")) throw new InvalidDataException("El asset del instalador no coincide con el índice.");
        _installerArtifact = new ArtifactInfo(installerVersion, name, size, hash, published.Url);
        InstallerUpdateText.Text = $"Actualización del instalador disponible: {installerVersion}";
        SelfUpdateButton.IsEnabled = true;
    }

    private async Task<JsonDocument?> LoadDistributionIndexAsync(ReleaseInfo release)
    {
        var indexAsset = release.Assets.FirstOrDefault(asset => asset.Name == "treseko-installer-release.json");
        if (indexAsset is null) return null;
        using var response = await Http.GetAsync(indexAsset.Url, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        if (response.RequestMessage?.RequestUri?.Host is not ("github.com" or "release-assets.githubusercontent.com")) throw new InvalidDataException("El índice se redirigió fuera de GitHub.");
        if (response.Content.Headers.ContentLength is > 1_048_576) throw new InvalidDataException("Índice de distribución demasiado grande.");
        var data = await response.Content.ReadAsByteArrayAsync();
        if (data.Length > 1_048_576) throw new InvalidDataException("Índice de distribución demasiado grande.");
        var index = JsonDocument.Parse(data);
        try
        {
            var root = index.RootElement;
            if (root.GetProperty("schema").GetInt32() != 1 || root.GetProperty("product").GetString() != "treseko-platform" || root.GetProperty("product_version").GetString() != release.Version || !ValidVersion(root.GetProperty("installer_version").GetString() ?? ""))
                throw new InvalidDataException("Índice de release inconsistente.");
            foreach (var artifact in root.GetProperty("artifacts").EnumerateObject())
            {
                var name = artifact.Value.GetProperty("name").GetString() ?? "";
                var size = artifact.Value.GetProperty("size").GetInt64();
                var digest = artifact.Value.GetProperty("sha256").GetString() ?? "";
                var published = release.Assets.SingleOrDefault(asset => asset.Name == name);
                if (published is null || published.Size != size || size <= 0 || !Regex.IsMatch(digest, "^[a-fA-F0-9]{64}$")) throw new InvalidDataException("El índice y los assets de GitHub no coinciden.");
            }
            return index;
        }
        catch { index.Dispose(); throw; }
    }

    private async Task<RuntimeInfo> DetectRuntimeAsync(int port)
    {
        try
        {
            var frontendData = await Http.GetByteArrayAsync($"http://127.0.0.1:{port}/version.json");
            using var frontend = JsonDocument.Parse(frontendData);
            if (frontend.RootElement.GetProperty("product").GetString() != "treseko-platform") return new("occupied", null, null);
            var frontVersion = frontend.RootElement.GetProperty("version").GetString();
            using var health = JsonDocument.Parse(await Http.GetByteArrayAsync($"http://127.0.0.1:{port}/api/health"));
            var backendVersion = health.RootElement.GetProperty("version").GetString();
            if (health.RootElement.GetProperty("status").GetString() != "ok") return new("unverified", frontVersion, backendVersion);
            return new(frontVersion == backendVersion ? "running" : "version_mismatch", frontVersion, backendVersion);
        }
        catch (HttpRequestException ex) when (ex.InnerException is System.Net.Sockets.SocketException socket && socket.SocketErrorCode == System.Net.Sockets.SocketError.ConnectionRefused)
        { return new("not_running", null, null); }
        catch { return new("unknown", null, null); }
    }

    private async Task<bool> RuntimeMatchesInstallationAsync(int port, string root)
    {
        var ids = await RunCommandAsync("docker", ["ps", "--filter", $"publish={port}", "--format", "{{.ID}}"], root);
        var containers = ids.Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (containers.Length != 1) return false;
        var labelsJson = await RunCommandAsync("docker", ["inspect", "--format={{json .Config.Labels}}", containers[0]], root);
        using var document = JsonDocument.Parse(labelsJson);
        var labels = document.RootElement;
        if (!labels.TryGetProperty("com.docker.compose.service", out var service) || service.GetString() != "frontend") return false;
        var expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { Path.GetFullPath(root) };
        var activePath = Path.Combine(root, ".treseko-local", "active-release.json");
        if (File.Exists(activePath))
        {
            using var active = JsonDocument.Parse(await File.ReadAllTextAsync(activePath));
            if (active.RootElement.TryGetProperty("release", out var rel))
            {
                var relative = rel.GetString() ?? "";
                if (!Path.IsPathRooted(relative) && !relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Contains(".."))
                    expected.Add(Path.GetFullPath(Path.Combine(root, ".treseko-local", "releases", relative)));
            }
        }
        var observed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (labels.TryGetProperty("com.docker.compose.project.working_dir", out var working)) observed.Add(Path.GetFullPath(working.GetString() ?? ""));
        if (labels.TryGetProperty("com.docker.compose.project.config_files", out var files))
            foreach (var file in (files.GetString() ?? "").Split(',')) if (!string.IsNullOrWhiteSpace(file)) observed.Add(Path.GetDirectoryName(Path.GetFullPath(file.Trim())) ?? "");
        return expected.Overlaps(observed);
    }

    private bool HasUnfinishedUpdate(string root)
    {
        var journal = Path.Combine(root, ".treseko-local", "update-transactions");
        if (!Directory.Exists(journal)) return File.Exists(journal);
        string[] terminal = ["committed", "rolled_back", "abandoned_before_mutation", "candidate_rejected"];
        try
        {
            foreach (var file in Directory.EnumerateFiles(journal, "*.json"))
            {
                using var data = JsonDocument.Parse(File.ReadAllText(file));
                if (!data.RootElement.TryGetProperty("phase", out var phase) || !terminal.Contains(phase.GetString())) return true;
            }
            return false;
        }
        catch { return true; }
    }

    private static bool IsRecognized(string root)
    {
        if (string.IsNullOrWhiteSpace(root)) return false;
        var names = new[] { "db-password", "database-url", "secret-key", "ai-credentials-master-key", "ai-engine-internal-token", "admin-password" };
        return File.Exists(Path.Combine(root, "compose.production.env")) && File.Exists(Path.Combine(root, "docker-compose.prod.yml"))
            && names.All(name => File.Exists(Path.Combine(root, ".treseko-local", "secrets", name)));
    }

    private static string? InstalledVersion(string root)
    {
        try
        {
            var active = Path.Combine(root, ".treseko-local", "active-release.json");
            if (File.Exists(active))
            {
                using var marker = JsonDocument.Parse(File.ReadAllText(active));
                var version = marker.RootElement.GetProperty("version").GetString();
                if (version is not null && ValidVersion(version)) return version;
            }
            var file = File.ReadAllText(Path.Combine(root, "VERSION")).Trim();
            return ValidVersion(file) ? file : null;
        }
        catch { return null; }
    }

    private static bool ValidVersion(string value) => Regex.IsMatch(value, @"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$");

    private static int CompareVersions(string left, string right)
    {
        var lhs = Regex.Match(left, @"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$");
        var rhs = Regex.Match(right, @"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$");
        if (!lhs.Success || !rhs.Success) return 0;
        for (var index = 1; index <= 3; index++)
        {
            var a = int.Parse(lhs.Groups[index].Value); var b = int.Parse(rhs.Groups[index].Value);
            if (a != b) return a.CompareTo(b);
        }
        var leftPre = lhs.Groups[4].Value; var rightPre = rhs.Groups[4].Value;
        if (leftPre == rightPre) return 0;
        if (leftPre.Length == 0) return 1;
        if (rightPre.Length == 0) return -1;
        var leftParts = leftPre.Split('.'); var rightParts = rightPre.Split('.');
        for (var i = 0; i < Math.Min(leftParts.Length, rightParts.Length); i++)
        {
            if (leftParts[i] == rightParts[i]) continue;
            var leftNumeric = int.TryParse(leftParts[i], out var leftNumber);
            var rightNumeric = int.TryParse(rightParts[i], out var rightNumber);
            if (leftNumeric && rightNumeric) return leftNumber.CompareTo(rightNumber);
            if (leftNumeric != rightNumeric) return leftNumeric ? -1 : 1;
            return string.CompareOrdinal(leftParts[i], rightParts[i]);
        }
        return leftParts.Length.CompareTo(rightParts.Length);
    }

    private int ParsePort() => int.TryParse(PortInput.Text, out var value) && value is >= 1 and <= 65535 ? value : throw new InvalidDataException("El puerto debe ser un número entre 1 y 65535.");

    private async void Check_Click(object sender, RoutedEventArgs e) => await RefreshAsync();

    private void ChooseRoot_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Seleccioná la raíz de la instalación Treseko" };
        if (dialog.ShowDialog(this) != true) return;
        if (!IsRecognized(dialog.FolderName)) { ModeText.Text = "La carpeta no contiene una instalación Treseko reconocible."; return; }
        InstallRootInput.Text = dialog.FolderName;
        _ = RefreshAsync();
    }

    private async void Install_Click(object sender, RoutedEventArgs e)
    {
        if (_release is null || _releaseVersion is null) return;
        try
        {
            SetBusy(true);
            _runtime = await DetectRuntimeAsync(ParsePort());
            var recognized = IsRecognized(InstallRootInput.Text);
            var updating = recognized;
            if (_runtime.State is not ("running" or "not_running")) throw new InvalidDataException("No se identificó un servicio Treseko sano en el puerto seleccionado.");
            if (_runtime.State == "running" && (!recognized || !await RuntimeMatchesInstallationAsync(ParsePort(), InstallRootInput.Text))) throw new InvalidDataException("No se pudo asociar la instancia activa con la raíz seleccionada.");
            if (recognized && HasUnfinishedUpdate(InstallRootInput.Text)) throw new InvalidDataException("Hay una transacción de actualización pendiente o interrumpida.");
            var current = _runtime.State == "running" ? _runtime.FrontendVersion : InstalledVersion(InstallRootInput.Text);
            if (current is not null && CompareVersions(_releaseVersion, current) <= 0) throw new InvalidDataException($"La versión destino {_releaseVersion} no es posterior a la instalada {current}.");
            var package = await ObtainPackageAsync(_release);
            var versionFile = (await File.ReadAllTextAsync(Path.Combine(package, "VERSION"))).Trim();
            if (versionFile != _releaseVersion) throw new InvalidDataException("El paquete descargado no coincide con el tag del release.");
            var script = Path.Combine(package, "scripts", "install_local_treseko.ps1");
            var args = new List<string> { "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-HttpPort", ParsePort().ToString() };
            if (updating) args.AddRange(["-Update", "-InstallRoot", InstallRootInput.Text]);
            ActivityText.Text = await RunCommandAsync("powershell.exe", args, package);
            await RefreshAsync();
            if (_runtime.State != "running" || _runtime.FrontendVersion != _releaseVersion) throw new InvalidDataException("Frontend y Backend no confirmaron la versión destino.");
            ActivityText.Text += "\r\nInstalación verificada correctamente.";
        }
        catch (Exception ex) { ActivityText.Text = ex.Message; }
        finally { SetBusy(false); }
    }

    private async Task<string> ObtainPackageAsync(ReleaseInfo release)
    {
        var cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Treseko", "packages");
        Directory.CreateDirectory(cache);
        var target = Path.Combine(cache, release.Tag);
        if (IsPackage(target)) return target;
        var staging = Path.Combine(cache, $".staging-{Guid.NewGuid():N}");
        Directory.CreateDirectory(staging);
        try
        {
            using var index = await LoadDistributionIndexAsync(release);
            var packageArtifact = index?.RootElement.GetProperty("artifacts").TryGetProperty("community-package", out var packageEntry) == true ? packageEntry : default;
            if (index is not null)
            {
                if (packageArtifact.ValueKind != JsonValueKind.Object) throw new InvalidDataException("El índice no incluye el paquete Community.");
                var name = packageArtifact.GetProperty("name").GetString() ?? "";
                var size = packageArtifact.GetProperty("size").GetInt64();
                var digest = packageArtifact.GetProperty("sha256").GetString() ?? "";
                var asset = release.Assets.Single(item => item.Name == name);
                var zip = Path.Combine(cache, name);
                await DownloadVerifiedAssetAsync(asset.Url, size, digest, zip);
                ZipFile.ExtractToDirectory(zip, staging);
            }
            else
            {
                using var response = await Http.GetAsync(release.Archive, HttpCompletionOption.ResponseHeadersRead);
                response.EnsureSuccessStatusCode();
                if (response.RequestMessage?.RequestUri?.Host != "api.github.com" || response.Content.Headers.ContentLength is > 536_870_912) throw new InvalidDataException("El paquete del release no es válido o supera el límite.");
                var zip = Path.Combine(cache, $"{Guid.NewGuid():N}.zip");
                await using (var output = File.Create(zip)) await response.Content.CopyToAsync(output);
                if (new FileInfo(zip).Length > 536_870_912) throw new InvalidDataException("El paquete de GitHub supera el límite de descarga.");
                ZipFile.ExtractToDirectory(zip, staging);
                File.Delete(zip);
            }
            var package = Directory.EnumerateDirectories(staging).FirstOrDefault(IsPackage) ?? (IsPackage(staging) ? staging : null);
            if (package is null) throw new InvalidDataException("El release no contiene el paquete de instalación.");
            Directory.Move(package, target);
        }
        finally { if (Directory.Exists(staging)) Directory.Delete(staging, true); }
        return target;
    }

    private async Task DownloadVerifiedAssetAsync(Uri url, long expectedSize, string expectedHash, string destination)
    {
        if (expectedSize <= 0 || expectedSize > 2L * 1024 * 1024 * 1024) throw new InvalidDataException("Tamaño de asset no permitido.");
        using var response = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        if (response.RequestMessage?.RequestUri?.Host is not ("github.com" or "release-assets.githubusercontent.com")) throw new InvalidDataException("Asset redirigido fuera de GitHub.");
        if (response.Content.Headers.ContentLength is long contentLength && contentLength != expectedSize) throw new InvalidDataException("Tamaño del asset no coincide.");
        var temporary = destination + ".staged";
        await using (var output = File.Create(temporary)) await response.Content.CopyToAsync(output);
        if (new FileInfo(temporary).Length != expectedSize) { File.Delete(temporary); throw new InvalidDataException("Tamaño del asset no coincide."); }
        await using var input = File.OpenRead(temporary);
        var digest = Convert.ToHexString(await SHA256.HashDataAsync(input)).ToLowerInvariant();
        if (digest != expectedHash.ToLowerInvariant()) { File.Delete(temporary); throw new InvalidDataException("SHA-256 del asset no coincide."); }
        File.Move(temporary, destination, true);
    }

    private static bool IsPackage(string root) => File.Exists(Path.Combine(root, "VERSION")) && File.Exists(Path.Combine(root, "docker-compose.prod.yml")) && File.Exists(Path.Combine(root, "scripts", "install_local_treseko.ps1"));

    private async void SelfUpdate_Click(object sender, RoutedEventArgs e)
    {
        if (_installerArtifact is null) return;
        try
        {
            SetBusy(true);
            var current = Environment.ProcessPath ?? throw new InvalidOperationException("No se pudo localizar el ejecutable actual.");
            var directory = Path.GetDirectoryName(current)!;
            if (!Directory.Exists(directory) || !HasWriteAccess(directory)) throw new InvalidOperationException("El instalador no tiene permisos para actualizarse en esta carpeta.");
            var temp = Path.Combine(Path.GetTempPath(), $"treseko-installer-{Guid.NewGuid():N}");
            Directory.CreateDirectory(temp);
            var staged = Path.Combine(temp, Path.GetFileName(current));
            using var response = await Http.GetAsync(_installerArtifact.Url, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();
            if (response.RequestMessage?.RequestUri?.Host is not ("github.com" or "release-assets.githubusercontent.com")) throw new InvalidDataException("La actualización fue redirigida fuera de GitHub.");
            await using (var output = File.Create(staged)) await response.Content.CopyToAsync(output);
            var info = new FileInfo(staged);
            if (info.Length != _installerArtifact.Size) throw new InvalidDataException("Tamaño del nuevo instalador no coincide.");
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(File.OpenRead(staged))).ToLowerInvariant();
            if (hash != _installerArtifact.Sha256) throw new InvalidDataException("SHA-256 del nuevo instalador no coincide.");
            var helper = Path.Combine(temp, "apply-update.ps1");
            await File.WriteAllTextAsync(helper, SelfUpdateScript);
            var args = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true };
            foreach (var value in new[] { "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-ProcessIdValue", Environment.ProcessId.ToString(), "-Current", current, "-Staged", staged }) args.ArgumentList.Add(value);
            Process.Start(args);
            Application.Current.Shutdown();
        }
        catch (Exception ex) { ActivityText.Text = ex.Message; SetBusy(false); }
    }

    private static readonly string SelfUpdateScript = """
param([int]$ProcessIdValue, [string]$Current, [string]$Staged)
$ErrorActionPreference = 'Stop'
while (Get-Process -Id $ProcessIdValue -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }
$Backup = "$Current.backup.$ProcessIdValue"
Move-Item -LiteralPath $Current -Destination $Backup
try {
  Move-Item -LiteralPath $Staged -Destination $Current
  Start-Process -FilePath $Current
} catch {
  if (Test-Path -LiteralPath $Current) { Remove-Item -LiteralPath $Current -Force }
  Move-Item -LiteralPath $Backup -Destination $Current
  Start-Process -FilePath $Current
  throw
}
""";

    private static bool HasWriteAccess(string path)
    {
        try { var file = Path.Combine(path, $".treseko-write-{Guid.NewGuid():N}"); using (File.Create(file)) { } File.Delete(file); return true; }
        catch { return false; }
    }

    private static async Task<string> RunCommandAsync(string command, IEnumerable<string> args, string workingDirectory)
    {
        var process = new Process { StartInfo = new ProcessStartInfo(command) { WorkingDirectory = workingDirectory, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true } };
        foreach (var arg in args) process.StartInfo.ArgumentList.Add(arg);
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        var output = (await stdout) + (await stderr);
        if (process.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(output) ? $"{command} terminó con código {process.ExitCode}." : output);
        return output;
    }

    private void SetBusy(bool busy)
    {
        Progress.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        InstallButton.IsEnabled = !busy && _canInstall;
        SelfUpdateButton.IsEnabled = !busy && _installerArtifact is not null;
    }

    private sealed record ReleaseInfo(string Version, string Tag, Uri Archive, AssetInfo[] Assets);
    private sealed record AssetInfo(string Name, long Size, Uri Url);
    private sealed record ArtifactInfo(string Version, string Name, long Size, string Sha256, Uri Url);
    private sealed record RuntimeInfo(string State, string? FrontendVersion, string? BackendVersion)
    {
        public string Message => State switch
        {
            "running" => $"Treseko en ejecución · Frontend y Backend {FrontendVersion}",
            "version_mismatch" => $"Versiones distintas · Frontend {FrontendVersion} · Backend {BackendVersion}",
            "not_running" => "No hay una instancia respondiendo en este puerto",
            _ => "Estado ambiguo · no se modificará ninguna instalación"
        };
    }
}
