from pathlib import Path


def test_windows_adapter_does_not_duplicate_selected_wsl_distribution():
    release_root = Path(__file__).resolve().parents[1]
    adapter = (release_root / "scripts" / "bootstrap_host_update_coordinator.ps1").read_text(
        encoding="utf-8"
    )

    assert adapter.count('$adapterArgs = @("--distribution", $Distro) + $adapterArgs') == 1
    assert "Invoke-Wsl $adapterArgs" in adapter
    assert "Invoke-Wsl ($wslPrefix + $adapterArgs)" not in adapter
