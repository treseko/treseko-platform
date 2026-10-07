#!/usr/bin/env python3
"""Instalador grafico multiplataforma de Treseko Community."""

from __future__ import annotations

import argparse
import json
import os
import py_compile
import platform
import queue
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import tkinter as tk
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from installer.bootstrap import build_gui_handoff_args, publish_release_tree
from installer.runtime_detection import compare_versions, detect_runtime, has_unfinished_update, installed_version, runtime_matches_installation
from installer.release_client import parse_latest_release
from installer.compose_bind_compat import persist_compose_bind_address, prepare_compose_bind_address


class TresekoInstaller(tk.Tk):
    GITHUB_LATEST_API = "https://api.github.com/repos/treseko/treseko-platform/releases/latest"
    MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
    MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
    MAX_ARCHIVE_FILES = 20_000
    VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")

    def __init__(self, initial: argparse.Namespace | None = None) -> None:
        super().__init__()
        self.title("Instalar Treseko Community")
        self.geometry("820x700")
        self.minsize(660, 500)
        self.configure(bg="#f6f8fb")
        self.repo_root = Path(initial.package).expanduser().resolve() if initial and initial.package else self._bundled_repo_root()
        self.installation_root = (
            Path(initial.installation_root).expanduser().resolve()
            if initial and getattr(initial, "installation_root", None)
            else self.repo_root
        )
        if not self._installation_recognized():
            cached_installation = self._find_cached_installation()
            if cached_installation:
                self.installation_root = cached_installation
        self.icon_path = Path(initial.icon).expanduser().resolve() if initial and getattr(initial, "icon", None) else None
        self.port_var = tk.StringVar(value=initial.port if initial and initial.port else "9095")
        self.share_network_var = tk.BooleanVar(value=False)
        self.demo_var = tk.BooleanVar(value=bool(initial.demo) if initial else False)
        self.mode_var = tk.StringVar(value=initial.mode if initial and initial.mode in {"new", "update", "uninstall", "reset"} else "new")
        self.purge_var = tk.BooleanVar(value=False)
        self.status_var = tk.StringVar(value="Comprobá los requisitos antes de instalar.")
        self.installation_state_var = tk.StringVar()
        self.runtime_state_var = tk.StringVar(value="Versión en ejecución: comprobando…")
        self.platform_var = tk.StringVar()
        self.package_var = tk.StringVar()
        self.installation_root_var = tk.StringVar(value=str(self.installation_root))
        self.events: queue.Queue[tuple[str, str]] = queue.Queue()
        self.cancel_event = threading.Event()
        self.install_running = False
        self.checks_ok = False
        self._active_process: subprocess.Popen[str] | None = None
        self._download_response = None
        self._destructive_install = False
        self._process_lock = threading.Lock()
        self._stages: dict[str, ttk.Label] = {}
        self._busy_widgets: list[tk.Widget] = []
        self._existing_install_widgets: list[tk.Widget] = []
        self._new_install_widgets: list[tk.Widget] = []
        self._network_access_widgets: list[tk.Widget] = []
        self._purge_widget: ttk.Checkbutton | None = None
        self._icon_image: tk.PhotoImage | None = None
        self._set_window_icon()
        self._build_ui()
        self._describe_platform()
        self._refresh_package_state()
        self._validate_port_inline()
        self.after(100, self._drain_events)
        if not self.package_ready:
            self.after(250, self._start_bootstrap_download)
        self.after(300, self._start_runtime_detection)

    def _build_ui(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("Title.TLabel", font=("Arial", 22, "bold"), foreground="#15233d")
        style.configure("Subtitle.TLabel", font=("Arial", 11), foreground="#52627b")
        style.configure("Primary.TButton", font=("Arial", 11, "bold"))
        shell = ttk.Frame(self, padding=18)
        shell.pack(fill="both", expand=True)
        canvas = tk.Canvas(shell, highlightthickness=0, bg="#f6f8fb")
        scrollbar = ttk.Scrollbar(shell, orient="vertical", command=canvas.yview)
        content = ttk.Frame(canvas, padding=10)
        window_id = canvas.create_window((0, 0), window=content, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        content.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda event: canvas.itemconfigure(window_id, width=event.width))
        self.bind_all("<MouseWheel>", lambda event: canvas.yview_scroll(int(-event.delta / 120), "units"))
        ttk.Label(content, text="Treseko Community", style="Title.TLabel").pack(anchor="w")
        ttk.Label(content, text="Instalá la plataforma con una comprobación guiada.", style="Subtitle.TLabel").pack(anchor="w", pady=(4, 16))
        platform_box = ttk.LabelFrame(content, text="Equipo detectado", padding=12)
        platform_box.pack(fill="x", pady=(0, 10))
        ttk.Label(platform_box, textvariable=self.platform_var, wraplength=680).pack(anchor="w")
        components = ttk.LabelFrame(content, text="Aplicación", padding=12)
        components.pack(fill="x", pady=(0, 10))
        for title, detail in (
            ("Interfaz web", "Pantallas para gestionar proyectos, pruebas y resultados."),
            ("Backend y API", "Reglas, acceso de usuarios y comunicación de la plataforma."),
        ):
            ttk.Label(components, text=f"✓  {title}", font=("Arial", 10, "bold")).pack(anchor="w")
            ttk.Label(components, text=detail, wraplength=660, foreground="#52627b").pack(anchor="w", padx=(24, 0), pady=(0, 4))
        data_services = ttk.LabelFrame(content, text="Servicios de datos", padding=12)
        data_services.pack(fill="x", pady=(0, 10))
        for title, detail in (
            ("PostgreSQL", "Base de datos que conserva proyectos, casos y resultados."),
            ("Redis", "Colas y coordinación interna entre servicios."),
        ):
            ttk.Label(data_services, text=f"✓  {title}", font=("Arial", 10, "bold")).pack(anchor="w")
            ttk.Label(data_services, text=detail, wraplength=660, foreground="#52627b").pack(anchor="w", padx=(24, 0), pady=(0, 4))
        ttk.Label(content, text="Durante la instalación: se crea o actualiza la estructura de la base de datos.", foreground="#52627b", wraplength=680).pack(anchor="w", pady=(0, 10))
        addons = ttk.LabelFrame(content, text="Complementos Treseko", padding=12)
        addons.pack(fill="x", pady=(0, 10))
        ttk.Label(addons, text="✓  Motor de IA", font=("Arial", 10, "bold")).pack(anchor="w")
        ttk.Label(addons, text="Se inicia con la instalación estándar; el proveedor de IA se configura después.", wraplength=660, foreground="#52627b").pack(anchor="w", padx=(24, 0), pady=(0, 4))
        ttk.Label(addons, text="✓  Worker de automatización · se instala en este equipo", font=("Arial", 10, "bold")).pack(anchor="w", pady=(4, 0))
        ttk.Label(addons, text="Queda en espera hasta vincularlo desde Automatización → Workers, después de crear una solución. Community admite un worker.", wraplength=660, foreground="#52627b").pack(anchor="w", padx=(24, 0), pady=(0, 4))
        config = ttk.LabelFrame(content, text="Configuración de instalación", padding=12)
        config.pack(fill="x", pady=(0, 10))
        port_row = ttk.Frame(config)
        port_row.pack(fill="x", pady=(0, 8))
        ttk.Label(port_row, text="Puerto local de Treseko:").pack(side="left")
        self.port_entry = ttk.Entry(port_row, textvariable=self.port_var, width=9)
        self.port_entry.pack(side="left", padx=(10, 8))
        self.port_entry.bind("<KeyRelease>", lambda _e: self._validate_port_inline())
        self.port_hint = ttk.Label(port_row, text="http://localhost:puerto", foreground="#52627b")
        self.port_hint.pack(side="left")
        access = ttk.LabelFrame(config, text="Acceso a Treseko", padding=8)
        access.pack(fill="x", pady=(4, 8))
        local_access = ttk.Radiobutton(access, text="Solo este equipo (recomendado)", variable=self.share_network_var, value=False)
        local_access.pack(anchor="w")
        ttk.Label(access, text="Abre Treseko desde esta computadora; no acepta conexiones de otros equipos.", foreground="#52627b", wraplength=640).pack(anchor="w", padx=(22, 0), pady=(0, 4))
        network_access = ttk.Radiobutton(access, text="Compartir en la red local", variable=self.share_network_var, value=True)
        network_access.pack(anchor="w")
        ttk.Label(access, text="Otros equipos de tu red podrán conectarse. El acceso desde Internet depende del firewall y requiere configurar un proxy HTTPS o VPN.", foreground="#8a5b00", wraplength=640).pack(anchor="w", padx=(22, 0))
        self._network_access_widgets = [local_access, network_access]
        new_mode = ttk.Radiobutton(config, text="Instalación nueva (no modifica una instalación previa)", variable=self.mode_var, value="new")
        new_mode.pack(anchor="w", pady=2)
        update_mode = ttk.Radiobutton(config, text="Actualizar (reutiliza exactamente configuración, secretos y volúmenes)", variable=self.mode_var, value="update")
        update_mode.pack(anchor="w", pady=2)
        purge_container = ttk.Frame(config)
        purge_container.pack(fill="x", pady=(7, 0))
        purge_check = ttk.Checkbutton(purge_container, text="PURGA TOTAL: borrar volúmenes y configuración local (requiere segunda confirmación)", variable=self.purge_var)
        purge_check.pack(anchor="w")
        ttk.Label(config, textvariable=self.installation_state_var, foreground="#52627b", wraplength=680).pack(anchor="w", pady=(7, 0))
        ttk.Label(config, textvariable=self.runtime_state_var, foreground="#52627b", wraplength=680).pack(anchor="w", pady=(4, 0))
        demo_check = ttk.Checkbutton(config, text="Cargar datos demo después de instalar", variable=self.demo_var)
        demo_check.pack(anchor="w", pady=(7, 0))
        location = ttk.Frame(config)
        location.pack(fill="x", pady=(12, 0))
        ttk.Label(location, text="Paquete:").pack(side="left")
        self.location_label = ttk.Label(location, textvariable=self.package_var, foreground="#52627b", wraplength=570)
        self.location_label.pack(side="left", padx=8, fill="x", expand=True)
        self.choose_package_button = ttk.Button(location, text="Cambiar", command=self._choose_package)
        self.choose_package_button.pack(side="right")
        installation_location = ttk.Frame(config)
        installation_location.pack(fill="x", pady=(7, 0))
        ttk.Label(installation_location, text="Instalación existente:").pack(side="left")
        self.installation_location_label = ttk.Label(
            installation_location, textvariable=self.installation_root_var,
            foreground="#52627b", wraplength=560,
        )
        self.installation_location_label.pack(side="left", padx=8, fill="x", expand=True)
        self.choose_installation_button = ttk.Button(
            installation_location, text="Seleccionar", command=self._choose_installation,
        )
        self.choose_installation_button.pack(side="right")
        self.release_label = ttk.Label(config, text="Versión: se determinará al validar el paquete", foreground="#52627b")
        self.release_label.pack(anchor="w", pady=(8, 0))
        actions = ttk.Frame(content)
        actions.pack(fill="x", pady=(0, 10))
        self.check_button = ttk.Button(actions, text="Comprobar requisitos", command=self._start_checks)
        self.check_button.pack(side="left")
        self.download_button = ttk.Button(actions, text="Descargar paquete", command=self._start_bootstrap_download)
        self.download_button.pack(side="left", padx=(8, 0))
        try:
            style.configure("Danger.TButton", foreground="#ffffff", background="#c9363e")
            style.map("Danger.TButton", background=[("active", "#a82731"), ("disabled", "#b8bec8")])
            danger_style = "Danger.TButton"
        except tk.TclError:
            danger_style = "TButton"
        self.uninstall_button = ttk.Button(actions, text="Desinstalar Treseko", style=danger_style, command=self._start_uninstall)
        self.uninstall_button.pack(side="right")
        self.install_button = ttk.Button(actions, text="Instalar Treseko", style="Primary.TButton", command=self._start_install)
        self.install_button.pack(side="right")
        self.cancel_button = ttk.Button(actions, text="Cancelar", command=self._cancel_operation, state="disabled")
        self.cancel_button.pack(side="right", padx=(0, 8))
        self._busy_widgets = [
            self.port_entry,
            new_mode,
            update_mode,
            purge_check,
            demo_check,
            self.choose_package_button,
            self.choose_installation_button,
            self.check_button,
            self.download_button,
            self.uninstall_button,
            self.install_button,
        ]
        self._existing_install_widgets = [update_mode]
        self._new_install_widgets = [new_mode]
        self._purge_container = purge_container
        self._purge_widget = purge_check
        self.mode_var.trace_add("write", lambda *_args: self._refresh_mode_controls())
        stages_box = ttk.LabelFrame(content, text="Progreso", padding=10)
        stages_box.pack(fill="x", pady=(0, 10))
        for key, label in (("preflight", "1. Requisitos"), ("download", "2. Paquete"), ("install", "3. Instalación"), ("verify", "4. Verificación final")):
            row = ttk.Frame(stages_box)
            row.pack(fill="x", pady=2)
            mark = ttk.Label(row, text="○", width=3, foreground="#52627b")
            mark.pack(side="left")
            ttk.Label(row, text=label).pack(side="left")
            self._stages[key] = mark
        self.progress = ttk.Progressbar(stages_box, mode="indeterminate")
        self.progress.pack(fill="x", pady=(8, 2))
        ttk.Label(content, textvariable=self.status_var, foreground="#52627b", wraplength=680).pack(anchor="w")
        log_frame = ttk.LabelFrame(content, text="Actividad", padding=8)
        log_frame.pack(fill="both", expand=True, pady=(10, 0))
        self.log = tk.Text(log_frame, height=11, wrap="word", state="disabled", bg="#101827", fg="#dbe7ff")
        self.log.pack(side="left", fill="both", expand=True)
        log_scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        log_scroll.pack(side="right", fill="y")
        self.log.configure(yscrollcommand=log_scroll.set)

    def _describe_platform(self) -> None:
        system, machine = platform.system(), platform.machine() or "desconocida"
        if system == "Darwin" and machine.lower() in {"arm64", "aarch64"}:
            detail = "Apple Silicon detectado. Se usará Docker Desktop; se verificará compatibilidad ARM64."
        elif system == "Windows":
            detail = "Windows detectado. Se usará Docker Desktop y PowerShell."
        elif system == "Linux":
            detail = "Linux detectado. Se usará Docker Engine/Compose (Ubuntu recomendado)."
        else:
            detail = "Sistema no probado oficialmente."
        self.platform_var.set(f"{system} · {machine} — {detail}")

    def _platform_script(self, root: Path | None = None) -> Path:
        root = root or self.repo_root
        system = platform.system()
        if system == "Windows":
            name = "install_local_treseko.ps1"
        elif system in {"Linux", "Darwin"}:
            name = "install_local_treseko.sh"
        else:
            raise ValueError(f"Sistema no soportado: {system}.")
        return root / "scripts" / name

    def _set_window_icon(self) -> None:
        """Usa el icono público del paquete cuando Tk lo admite."""
        if platform.system() != "Linux":
            return
        candidates = [self.icon_path] if self.icon_path else []
        candidates.append(self._bundled_icon_path())
        candidates.append(self.repo_root / "installer" / "treseko-installer.png")
        candidates.append(self.repo_root / "frontend" / "public" / "gecko-community-icon.png")
        for candidate in candidates:
            if candidate and candidate.is_file() and not candidate.is_symlink():
                try:
                    self._icon_image = tk.PhotoImage(file=str(candidate))
                    self.iconphoto(False, self._icon_image)
                except tk.TclError:
                    pass
                return

    @staticmethod
    def _bundled_root() -> Path:
        """Devuelve el root de recursos de PyInstaller o el árbol fuente."""
        frozen_root = getattr(sys, "_MEIPASS", None)
        return Path(frozen_root).resolve() if frozen_root else Path(__file__).resolve().parents[1]

    @classmethod
    def _bundled_icon_path(cls) -> Path:
        return cls._bundled_root() / "installer" / "treseko-installer.png"

    @classmethod
    def _bundled_repo_root(cls) -> Path:
        # Un ejecutable standalone no contiene el repo: arranca en modo
        # bootstrap y descarga el paquete oficial cuando sea necesario.
        candidate = cls._bundled_root()
        return candidate if (candidate / "VERSION").is_file() else candidate / "missing-package"

    def _version(self, root: Path) -> str:
        value = (root / "VERSION").read_text(encoding="utf-8").strip()
        if not self.VERSION_RE.fullmatch(value):
            raise ValueError("VERSION no tiene un formato válido.")
        return value

    def _is_valid_package(self, root: Path, expected_tag: str | None = None) -> bool:
        try:
            version = self._version(root)
            platform_script = self._platform_script(root)
        except (OSError, ValueError):
            return False
        # La GUI puede abrirse como bootstrap fuera del paquete. Releases
        # públicos anteriores al instalador no contienen este archivo, pero sí
        # todo lo necesario para la instalación CLI.
        required_files = (root / "docker-compose.prod.yml", platform_script)
        root_resolved = root.resolve()
        if not all(path.is_file() and not path.is_symlink() for path in required_files):
            return False
        if any(not path.resolve().is_relative_to(root_resolved) for path in required_files):
            return False
        if expected_tag:
            match = re.search(r"(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$", expected_tag)
            if not match or match.group(1) != version:
                return False
        return True

    def _refresh_package_state(self) -> None:
        self.package_var.set(str(self.repo_root))
        self.package_ready = self._is_valid_package(self.repo_root)
        if self.package_ready:
            self.release_label.configure(text=f"Versión del paquete: {self._version(self.repo_root)} · validado")
        else:
            self.release_label.configure(text="Versión: paquete incompleto o inválido para este sistema")
        self.download_button.configure(state="disabled" if self.package_ready else "normal")
        self._refresh_mode_controls()

    def _installation_recognized(self) -> bool:
        return self._installation_recognized_at(self.installation_root)

    @staticmethod
    def _installation_recognized_at(root: Path) -> bool:
        secrets = root / ".treseko-local" / "secrets"
        required = (root / "compose.production.env", root / "docker-compose.prod.yml")
        secret_names = ("db-password", "database-url", "secret-key", "ai-credentials-master-key", "ai-engine-internal-token", "admin-password")
        return all(path.is_file() and not path.is_symlink() for path in required) and secrets.is_dir() and all((secrets / name).is_file() and not (secrets / name).is_symlink() for name in secret_names)

    def _find_cached_installation(self, cache_root: Path | None = None) -> Path | None:
        """Busca solo paquetes directos de la caché de Treseko, sin recorrer el home."""
        packages_root = cache_root or (Path.home() / ".cache" / "treseko" / "packages")
        try:
            candidates = [path for path in packages_root.iterdir() if path.is_dir() and not path.is_symlink()]
        except OSError:
            return None
        for candidate in sorted(candidates, key=lambda path: path.stat().st_mtime, reverse=True):
            if self._is_valid_package(candidate) and (candidate / "compose.production.env").is_file() and self._installation_recognized_at(candidate):
                return candidate.resolve()
        return None

    def _start_uninstall(self) -> None:
        if self.install_running or not self._installation_recognized():
            return
        self.mode_var.set("uninstall")
        self._start_install()

    def _refresh_mode_controls(self) -> None:
        recognized = self._installation_recognized()
        detection = getattr(self, "runtime_detection", None)
        runtime_occupies_port = detection is not None and detection.state not in {"not_running"}
        target_version = self._version(self.repo_root) if getattr(self, "package_ready", False) else None
        current_version = detection.version if detection and detection.state in {"running", "version_mismatch", "unverified_treseko"} else (installed_version(self.installation_root) if recognized else None)
        journal_pending = recognized and has_unfinished_update(self.installation_root)
        version_mismatch = bool(detection and detection.state == "version_mismatch")
        root_version_mismatch = bool(
            detection and detection.state == "running" and recognized
            and installed_version(self.installation_root) != detection.version
        )
        wrong_installation = bool(detection and detection.state == "running" and recognized and getattr(detection, "installation_matches", None) is not True)
        downgrade = bool(target_version and current_version and compare_versions(target_version, current_version) < 0)
        same_version = bool(target_version and current_version and compare_versions(target_version, current_version) == 0)
        ambiguous_runtime = detection is not None and detection.state in {"occupied", "unknown", "unverified_treseko"}
        can_update = recognized and not journal_pending and not version_mismatch and not root_version_mismatch and not wrong_installation and not downgrade and not same_version and not ambiguous_runtime
        can_new = not recognized and not runtime_occupies_port
        show_purge = recognized and self.mode_var.get() == "uninstall"
        if journal_pending:
            installation_text = "Hay una actualización pendiente o interrumpida. No se iniciará otra desde el instalador; revisá el estado y recuperación de la instalación."
        elif version_mismatch:
            installation_text = "La instalación fue detectada, pero Frontend y Backend reportan versiones distintas. No se actualizará hasta resolver esa discrepancia."
        elif root_version_mismatch:
            installation_text = "La versión que reporta Treseko no coincide con la última versión registrada en la raíz seleccionada. No se actualizará una instalación ambigua."
        elif wrong_installation:
            installation_text = "Treseko responde en el puerto, pero Docker no pudo demostrar que pertenece a la raíz seleccionada. No se actualizará una instancia ambigua."
        elif downgrade:
            installation_text = f"La versión destino ({target_version}) es anterior a la detectada ({current_version}); se bloquea la degradación."
        elif recognized:
            installation_text = "Instalación reconocida. La actualización reutiliza su configuración, secretos y volúmenes."
        elif runtime_occupies_port:
            installation_text = "El puerto configurado está ocupado o Treseko no se pudo identificar. No se permite instalar encima; seleccioná la instalación correcta o liberá el puerto."
        else:
            installation_text = "No se detectó una instalación existente en este destino. Podés realizar una instalación nueva."
        self.installation_state_var.set(installation_text)
        self.install_button.configure(text="Actualizar Treseko" if self.mode_var.get() == "update" else "Instalar Treseko")
        for widget in self._existing_install_widgets:
            widget.configure(state="normal" if can_update else "disabled")
        self.uninstall_button.configure(state="normal" if recognized and not journal_pending and not version_mismatch else "disabled")
        for widget in getattr(self, "_new_install_widgets", []):
            widget.configure(state="normal" if can_new else "disabled")
        install_allowed = can_update if self.mode_var.get() == "update" else can_new if self.mode_var.get() == "new" else recognized and not journal_pending
        self.install_button.configure(state="normal" if install_allowed else "disabled")
        access_enabled = self.mode_var.get() in {"new", "reset"}
        for widget in self._network_access_widgets:
            widget.configure(state="normal" if access_enabled else "disabled")
        if show_purge:
            if not self._purge_container.winfo_ismapped():
                self._purge_container.pack(fill="x", pady=(7, 0), before=self._purge_container.master.winfo_children()[-1])
        else:
            self.purge_var.set(False)
            self._purge_container.pack_forget()
        if self._purge_widget is not None:
            self._purge_widget.configure(state="normal" if show_purge else "disabled")
        if (not can_update and self.mode_var.get() == "update") or (not recognized and self.mode_var.get() == "uninstall"):
            self.mode_var.set("new")

    def _start_runtime_detection(self) -> None:
        try:
            port = self._validate_port()
        except (ValueError, TypeError):
            return
        threading.Thread(target=self._runtime_detection_worker, args=(port,), daemon=True).start()

    def _runtime_detection_worker(self, port: int) -> None:
        result = detect_runtime(port)
        installation_matches = runtime_matches_installation(port, self.installation_root) if result.state == "running" and self._installation_recognized() else None
        self.events.put(("runtime-detection", json.dumps({
            "state": result.state,
            "version": result.version,
            "backend_version": result.backend_version,
            "detail": result.detail,
            "installation_matches": installation_matches,
        })))

    def _choose_package(self) -> None:
        selected = filedialog.askdirectory(title="Seleccioná la carpeta de Treseko Community")
        if not selected:
            return
        root = Path(selected).expanduser().resolve()
        if not self._is_valid_package(root):
            messagebox.showerror("Paquete inválido", "El paquete no contiene los archivos válidos para este sistema operativo.")
            return
        self.repo_root = root
        self.runtime_detection = None
        self.checks_ok = False
        self._refresh_package_state()
        self.status_var.set("Paquete cambiado. Volvé a comprobar los requisitos.")

    def _choose_installation(self) -> None:
        selected = filedialog.askdirectory(title="Seleccioná la carpeta de la instalación Treseko existente")
        if not selected:
            return
        root = Path(selected).expanduser().resolve()
        if not self._installation_recognized_at(root):
            messagebox.showerror(
                "Instalación no reconocida",
                "La carpeta seleccionada no contiene una instalación Treseko reconocible. No se cambió el destino.",
            )
            return
        self.installation_root = root
        self.installation_root_var.set(str(root))
        self.runtime_detection = None
        self._refresh_mode_controls()
        self._start_runtime_detection()

    def _capture_config(self) -> dict[str, object]:
        """Lee Tkinter únicamente en el hilo principal."""
        return {
            "port": self.port_var.get().strip(),
            "bind_address": "0.0.0.0" if self.share_network_var.get() else "127.0.0.1",
            "demo": bool(self.demo_var.get()),
            "mode": self.mode_var.get(),
            "purge": bool(self.purge_var.get()),
            "package": self.repo_root,
            "installation_root": self.installation_root,
        }

    def _set_busy(self, busy: bool) -> None:
        self.install_running = busy
        for widget in self._busy_widgets:
            widget.configure(state="disabled" if busy else "normal")
        if not busy:
            self.download_button.configure(state="disabled" if self.package_ready else "normal")
            self._refresh_mode_controls()
        self.cancel_button.configure(state="normal" if busy else "disabled")
        if busy:
            self.cancel_event.clear()
            self.progress.start(10)
        else:
            self.progress.stop()

    def _set_stage(self, key: str, state: str) -> None:
        symbols = {"pending": "○", "running": "●", "done": "✓", "error": "!", "cancelled": "–"}
        colors = {"pending": "#52627b", "running": "#2864e8", "done": "#238636", "error": "#c9363e", "cancelled": "#9b6b00"}
        self._stages[key].configure(text=symbols[state], foreground=colors[state])

    def _validate_port(self) -> int:
        port = int(self.port_var.get().strip())
        if not 1 <= port <= 65535:
            raise ValueError
        return port

    def _validate_port_inline(self) -> None:
        try:
            self._validate_port()
            self.port_hint.configure(text="Puerto válido", foreground="#238636")
        except (ValueError, TypeError):
            self.port_hint.configure(text="Debe ser un puerto entre 1 y 65535", foreground="#c9363e")

    def _start_bootstrap_download(self) -> None:
        if self.install_running:
            return
        config = self._capture_config()
        self._set_busy(True)
        self._set_stage("download", "running")
        self.status_var.set("Buscando el último paquete estable de GitHub...")
        threading.Thread(target=self._bootstrap_worker, args=(config,), daemon=True).start()

    def _bootstrap_worker(self, config: dict[str, object]) -> None:
        # La configuración se captura en el hilo principal antes de iniciar este worker.
        del config
        cache_root = Path.home() / ".cache" / "treseko" / "packages"
        try:
            request = urllib.request.Request(self.GITHUB_LATEST_API, headers={"Accept": "application/vnd.github+json", "User-Agent": "Treseko-Installer"})
            with urllib.request.urlopen(request, timeout=30) as response:
                release = parse_latest_release(json.load(response))
            tag = release.tag
            archive_url = release.archive_url
            target = cache_root / tag
            if not self._is_valid_package(target, tag):
                cache_root.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(prefix="treseko-download-", dir=str(cache_root)) as temp_dir:
                    temp_dir_path = Path(temp_dir)
                    archive_path = temp_dir_path / "treseko.zip"
                    self._download_archive(archive_url, archive_path)
                    extract_dir = temp_dir_path / "extract"
                    extract_dir.mkdir()
                    total = 0
                    with zipfile.ZipFile(archive_path) as archive:
                        members = archive.infolist()
                        if len(members) > self.MAX_ARCHIVE_FILES:
                            raise RuntimeError("El paquete contiene demasiados archivos.")
                        for member in members:
                            path = Path(member.filename)
                            if path.is_absolute() or ".." in path.parts:
                                raise RuntimeError("El paquete descargado contiene una ruta insegura.")
                            total += member.file_size
                            if total > self.MAX_UNCOMPRESSED_BYTES:
                                raise RuntimeError("El paquete descomprimido supera el límite permitido.")
                        archive.extractall(extract_dir)
                    roots = [
                        path for path in (extract_dir, *extract_dir.rglob("*"))
                        if path.is_dir() and not path.is_symlink()
                    ]
                    package = next((path for path in roots if self._is_valid_package(path, tag)), None)
                    if package is None:
                        raise RuntimeError("El release no contiene un paquete válido para este sistema.")
                    try:
                        publish_release_tree(package, target)
                    except FileExistsError:
                        # A concurrent bootstrap may have won the same
                        # immutable-tag publication. Reuse only a complete,
                        # valid package; never remove or overwrite the tree.
                        if not self._is_valid_package(target, tag):
                            raise RuntimeError("El destino del release ya existe, pero no es un paquete válido; no se modificó.")
            gui_path = target / "installer" / "treseko_installer.py"
            self.events.put(("bootstrap", json.dumps({"package": str(target), "gui": str(gui_path), "tag": tag})))
        except Exception as exc:
            self.events.put(("cancelled" if self.cancel_event.is_set() else "bootstrap-error", str(exc)))

    def _download_archive(self, url: str, destination: Path) -> None:
        request = urllib.request.Request(url, headers={"User-Agent": "Treseko-Installer"})
        with urllib.request.urlopen(request, timeout=30) as response:
            self._download_response = response
            size = 0
            with destination.open("wb") as output:
                while not self.cancel_event.is_set():
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > self.MAX_ARCHIVE_BYTES:
                        raise RuntimeError("El paquete descargado supera el límite permitido.")
                    output.write(chunk)
            self._download_response = None
            if self.cancel_event.is_set():
                raise RuntimeError("Descarga cancelada.")

    def _run_command(self, args: list[str], cwd: Path, timeout: int = 30) -> tuple[bool, str]:
        try:
            completed = subprocess.run(args, cwd=str(cwd), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return False, str(exc)
        return completed.returncode == 0, completed.stdout.strip()

    def _check_config(self, config: dict[str, object]) -> list[str]:
        failures: list[str] = []
        root, port, mode = config["package"], config["port"], config["mode"]
        if not isinstance(root, Path) or not self._is_valid_package(root):
            failures.append("El paquete no es válido para este sistema operativo.")
        # En una instalación nueva el puerto debe estar libre. En update/reset
        # el servicio existente puede ocuparlo legítimamente; en uninstall no
        # se necesita validarlo porque no se va a iniciar ningún servicio.
        if mode == "new":
            try:
                port_number = int(str(port))
                if not 1 <= port_number <= 65535:
                    raise ValueError
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                    if sock.connect_ex(("127.0.0.1", port_number)) == 0:
                        failures.append(f"El puerto {port_number} ya está ocupado.")
            except (ValueError, TypeError):
                failures.append("El puerto debe ser un número entre 1 y 65535.")
        docker = shutil.which("docker")
        if not docker:
            failures.append("No se encontró Docker. Instalá Docker Desktop o Docker Engine.")
        else:
            for command, label, timeout in [([docker, "--version"], "Docker", 20), ([docker, "compose", "version"], "Docker Compose v2", 20), ([docker, "info"], "motor Docker", 30)]:
                ok, output = self._run_command(command, root, timeout)
                self.events.put(("log", f"$ {' '.join(command)}\n{output[-1200:]}\n"))
                if not ok:
                    failures.append(f"No se pudo comprobar {label}. Iniciá Docker Desktop/Engine y reintentá.")
        installation_root = config.get("installation_root")
        env_file = installation_root / "compose.production.env" if isinstance(installation_root, Path) else None
        if mode == "new" and env_file is not None and env_file.is_file():
            failures.append("Ya existe una configuración local. Elegí recrear el entorno o usá el flujo de actualización.")
        if mode in {"update", "uninstall"} and not self._installation_recognized():
            failures.append("No existe compose.production.env; actualización/eliminación requieren una instalación existente.")
        runtime = None
        if mode in {"new", "update"}:
            try:
                runtime_port = int(str(port))
                if not 1 <= runtime_port <= 65535:
                    raise ValueError
            except (ValueError, TypeError):
                failures.append("El puerto debe ser un número entre 1 y 65535.")
            else:
                runtime = detect_runtime(runtime_port)
        if mode == "new":
            if runtime is not None and runtime.state != "not_running":
                failures.append("El puerto responde o su estado es ambiguo. No se iniciará una instalación nueva para evitar interferir con una instancia existente.")
            elif self._installation_recognized():
                failures.append("Ya se reconoció una instalación en el destino. Elegí Actualizar en lugar de Instalación nueva.")
        if mode == "update":
            if runtime is None:
                pass
            elif runtime.state not in {"running", "not_running"}:
                failures.append("No se pudo identificar y verificar la instalación en ejecución. No se iniciará la actualización.")
            elif runtime.state == "running":
                if not self._installation_recognized():
                    failures.append("Treseko está ejecutándose, pero no se identificó su raíz de instalación. Seleccioná la instalación correcta antes de actualizar.")
                elif installed_version(self.installation_root) != runtime.version:
                    failures.append("La versión en ejecución no coincide con la versión registrada en la raíz seleccionada. No se actualizará una instalación ambigua.")
                elif runtime_matches_installation(int(str(port)), self.installation_root) is not True:
                    failures.append("Docker no pudo demostrar que la instancia que ocupa el puerto pertenece a la raíz seleccionada. No se actualizará una instalación ambigua.")
            elif not self._installation_recognized() or not installed_version(self.installation_root):
                failures.append("Los servicios están detenidos y no se pudo confirmar la versión registrada de la instalación seleccionada.")
            elif compare_versions(self._version(root), installed_version(self.installation_root) or "0.0.0") <= 0:
                failures.append("La versión destino debe ser más nueva que la versión instalada; no se permiten reintentos de la misma versión ni degradaciones.")
            if self._installation_recognized() and has_unfinished_update(self.installation_root):
                failures.append("Hay una transacción de actualización pendiente o interrumpida. Debe reconciliarse antes de iniciar otra.")
        if platform.system() not in {"Windows", "Linux", "Darwin"}:
            failures.append(f"Sistema no soportado: {platform.system()}.")
        return failures

    def _start_checks(self) -> None:
        if self.install_running:
            return
        config = self._capture_config()
        self._set_busy(True)
        self._set_stage("preflight", "running")
        self.status_var.set("Comprobando Docker, Compose, puerto y paquete...")
        threading.Thread(target=self._check_worker, args=(config,), daemon=True).start()

    def _check_worker(self, config: dict[str, object]) -> None:
        self.events.put(("checks", "\n".join(self._check_config(config))))

    def _start_install(self) -> None:
        if self.install_running:
            return
        config = self._capture_config()
        mode = str(config["mode"])
        if mode == "reset" and not messagebox.askyesno("Confirmar recreación", "Se borrarán los volúmenes locales de Treseko y sus datos. Esta acción no es reversible desde la GUI. ¿Continuar?", icon="warning"):
            return
        if mode == "uninstall":
            if not messagebox.askyesno("Confirmar eliminación", "Se detendrán y quitarán los contenedores y redes. Los volúmenes y la configuración se conservarán. ¿Continuar?", icon="warning"):
                return
            if bool(config["purge"]):
                if not messagebox.askyesno("CONFIRMACIÓN ADICIONAL: eliminación total", "Se borrarán también los volúmenes y la configuración local de este paquete. Esta acción no es reversible. ¿Confirmás la eliminación total?", icon="warning"):
                    return
        self._set_busy(True)
        self._destructive_install = config["mode"] == "reset" or (config["mode"] == "uninstall" and bool(config.get("purge", False)))
        self._set_stage("preflight", "running")
        self.status_var.set("Comprobando requisitos antes de instalar...")
        threading.Thread(target=self._check_then_install, args=(config,), daemon=True).start()

    def _check_then_install(self, config: dict[str, object]) -> None:
        failures = self._check_config(config)
        if self.cancel_event.is_set():
            self.events.put(("cancelled", "Comprobación cancelada. No se inició la instalación."))
            return
        if failures:
            self.events.put(("checks", "\n".join(failures)))
            return
        self.events.put(("preflight-ok", "Requisitos correctos. Iniciando la instalación."))
        if self.cancel_event.is_set():
            self.events.put(("cancelled", "Instalación cancelada antes de iniciar. No se modificaron datos."))
            return
        self._run_install_command(config)

    def _run_install_command(self, config: dict[str, object]) -> None:
        root = config["package"]
        port, demo, mode = str(config["port"]), bool(config["demo"]), str(config["mode"])
        script = self._platform_script(root if isinstance(root, Path) else None)
        process_env = os.environ.copy()
        if mode == "new":
            try:
                prepare_compose_bind_address(root if isinstance(root, Path) else Path(root))
            except (OSError, ValueError) as exc:
                self.events.put(("install", f"ERROR|No se puede preparar el acceso de red con seguridad: {exc}"))
                return
            process_env["TRESEKO_BIND_ADDRESS"] = str(config["bind_address"])
        # Un release antiguo puede contener el compose y la instalación ya
        # existente, pero todavía no conocer --update/--uninstall. Cuando la
        # GUI se ejecuta desde el bundle standalone, usar sus scripts nuevos
        # para las operaciones de ciclo de vida y mantener el compose/env del
        # paquete instalado como cwd.
        if mode in {"update", "uninstall", "reset"} and isinstance(root, Path):
            bundled_script = self._platform_script(Path(__file__).resolve().parents[1])
            # El script calcula su REPO_ROOT desde su propia ubicación. Por
            # eso, si el release cacheado es antiguo, actualizamos solamente
            # su copia del script antes de ejecutarlo; así conserva el env,
            # secretos y volúmenes del paquete instalado.
            try:
                script_text = script.read_text(encoding="utf-8")
            except OSError:
                script_text = ""
            needs_lifecycle_script = mode in {"update", "uninstall"} and "--update" not in script_text
            needs_lifecycle_script = needs_lifecycle_script or (mode == "reset" and "--confirm-reset" not in script_text)
            if bundled_script.is_file() and needs_lifecycle_script and script.resolve() != bundled_script.resolve():
                shutil.copy2(bundled_script, script)
        if platform.system() == "Windows":
            command = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)]
            if isinstance(config.get("installation_root"), Path) and config["installation_root"].resolve() != root.resolve():
                command.extend(["-InstallRoot", str(config["installation_root"])])
            if mode not in {"update", "uninstall"}:
                command.extend(["-HttpPort", port])
            if demo and mode == "new":
                command.append("-WithDemo")
            if mode == "reset":
                command.append("-Reset")
                command.append("-ConfirmReset")
            elif mode == "update":
                command.append("-Update")
            elif mode == "uninstall":
                command.append("-Uninstall")
                if bool(config.get("purge", False)):
                    command.extend(["-PurgeData", "-ConfirmPurge"])
        else:
            command = ["bash", str(script)]
            if isinstance(config.get("installation_root"), Path) and config["installation_root"].resolve() != root.resolve():
                command.extend(["--install-root", str(config["installation_root"])])
            if mode not in {"update", "uninstall"}:
                command.extend(["--http-port", port])
            if demo and mode == "new":
                command.append("--with-demo")
            if mode == "reset":
                command.append("--reset")
                command.append("--confirm-reset")
            elif mode == "update":
                command.append("--update")
            elif mode == "uninstall":
                command.append("--uninstall")
                if bool(config.get("purge", False)):
                    command.extend(["--purge-data", "--confirm-purge"])
        self.events.put(("log", "\nIniciando instalación...\n"))
        process: subprocess.Popen[str] | None = None
        try:
            process = subprocess.Popen(command, cwd=str(root), env=process_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            with self._process_lock:
                self._active_process = process
            assert process.stdout is not None
            for line in process.stdout:
                if self.cancel_event.is_set():
                    break
                self.events.put(("log", line))
            if self.cancel_event.is_set() and process.poll() is None:
                if mode != "reset":
                    process.terminate()
            result = process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            assert process is not None
            process.kill()
            result = process.wait()
        except OSError as exc:
            self.events.put(("install", f"ERROR|No se pudo iniciar el instalador: {exc}"))
            return
        finally:
            with self._process_lock:
                self._active_process = None
        if self.cancel_event.is_set():
            if mode == "reset":
                self.events.put(("install", "ERROR|La recreación estaba en una operación crítica y no se puede cancelar de forma segura."))
            else:
                self.events.put(("cancelled", "Instalación cancelada. No se ejecutaron acciones adicionales."))
        elif result == 0:
            if mode == "new":
                try:
                    persist_compose_bind_address(root if isinstance(root, Path) else Path(root), str(config["bind_address"]))
                except (OSError, ValueError) as exc:
                    self.events.put(("log", f"ADVERTENCIA|La instalación terminó, pero no se pudo guardar la dirección de escucha: {exc}\n"))
            self.events.put(("uninstall-success" if mode == "uninstall" else "install-success", port))
        else:
            self.events.put(("install", f"ERROR|El instalador terminó con código {result}. Revisá la actividad."))

    def _verify_installation(self, port: int, expected_version: str) -> tuple[bool, str]:
        base = f"http://127.0.0.1:{port}"
        try:
            with urllib.request.urlopen(base + "/", timeout=10) as response:
                if not 200 <= response.status < 400:
                    return False, f"La interfaz respondió HTTP {response.status}."
            health_verified = False
            for path in ("/health", "/api/health"):
                try:
                    with urllib.request.urlopen(base + path, timeout=10) as response:
                        if not 200 <= response.status < 300:
                            continue
                        body = json.load(response)
                        if isinstance(body, dict) and str(body.get("status", "")).lower() in {"ok", "healthy", "online"}:
                            health_verified = True
                            break
                except (OSError, urllib.error.URLError):
                    continue
                except (ValueError, json.JSONDecodeError):
                    continue
            if not health_verified:
                return False, "No se pudo confirmar el health check de la aplicación."
            with urllib.request.urlopen(base + "/version.json", timeout=10) as response:
                frontend_payload = json.load(response)
                actual = str(frontend_payload.get("version", "")).strip()
                if frontend_payload.get("product") != "treseko-platform":
                    return False, "El servicio respondió, pero no se identificó como Treseko."
            if actual != expected_version:
                return False, f"La versión publicada ({actual or 'desconocida'}) no coincide con {expected_version}."
            with urllib.request.urlopen(base + "/api/health", timeout=10) as response:
                backend_payload = json.load(response)
            backend_version = str(backend_payload.get("version", "")).strip()
            if backend_payload.get("status") != "ok" or backend_version != expected_version:
                return False, f"Backend reporta {backend_version or 'una versión desconocida'}; se esperaba {expected_version}."
        except (OSError, urllib.error.URLError, ValueError, json.JSONDecodeError) as exc:
            return False, f"No se pudo verificar HTTP/health/version: {exc}"
        return True, f"HTTP, health y versión {expected_version} verificados."

    def _verify_worker(self, port: int, expected_version: str) -> None:
        ok, detail = self._verify_installation(port, expected_version)
        self.events.put(("verify-result", json.dumps({"ok": ok, "detail": detail, "port": port})))

    def _cancel_operation(self) -> None:
        if not self.install_running:
            return
        with self._process_lock:
            active_process = self._active_process
        if self._destructive_install and active_process is not None:
            messagebox.showwarning(
                "Operación crítica en curso",
                "La recreación desde cero ya comenzó y no se puede cancelar sin riesgo para los datos. Esperá a que termine.",
            )
            return
        self.cancel_event.set()
        if self._download_response is not None:
            try:
                self._download_response.close()
            except OSError:
                pass
        with self._process_lock:
            process = self._active_process
        if process is not None and process.poll() is None:
            try:
                process.terminate()
            except OSError:
                pass
        self.cancel_button.configure(state="disabled")
        self.status_var.set("Cancelando de forma segura...")

    def _write_log(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _drain_events(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "log":
                    self._write_log(payload)
                elif kind == "checks":
                    self._set_stage("preflight", "error" if payload else "done")
                    self._set_busy(False)
                    if payload:
                        self.checks_ok = False
                        self.status_var.set("Hay requisitos pendientes.")
                        self._write_log("\nREQUISITOS PENDIENTES:\n" + payload + "\n")
                        messagebox.showerror("No se puede continuar", payload)
                    else:
                        self.checks_ok = True
                        self.status_var.set("Requisitos correctos. La instalación puede comenzar.")
                        self._write_log("\nTodos los requisitos están correctos.\n")
                elif kind == "preflight-ok":
                    self._set_stage("preflight", "done")
                    self._set_stage("install", "running")
                    self.status_var.set(payload)
                    self._write_log("\n" + payload + "\n")
                elif kind == "install-success":
                    port = int(payload)
                    expected_version = self._version(self.repo_root)
                    self._set_stage("install", "done")
                    self._set_stage("verify", "running")
                    self.status_var.set("Instalación terminada. Verificando servicios, versión y URL...")
                    threading.Thread(
                        target=self._verify_worker,
                        args=(port, expected_version),
                        daemon=True,
                    ).start()
                elif kind == "uninstall-success":
                    self._set_stage("install", "done")
                    self._set_busy(False)
                    self._destructive_install = False
                    self.purge_var.set(False)
                    self.mode_var.set("new")
                    for stage in self._stages:
                        self._set_stage(stage, "pending")
                    self.status_var.set("Treseko fue eliminado; se conservaron los datos salvo que elegiste eliminación total.")
                    self._write_log("\nEliminación completada.\n")
                    self._refresh_package_state()
                elif kind == "verify-result":
                    data = json.loads(payload)
                    ok, detail = bool(data["ok"]), str(data["detail"])
                    port = int(data["port"])
                    self._set_stage("verify", "done" if ok else "error")
                    self._set_busy(False)
                    self._destructive_install = False
                    if ok:
                        url = f"http://localhost:{port}"
                        self.status_var.set("Treseko quedó instalado y verificado correctamente.")
                        self._write_log("\nVERIFICACIÓN FINAL: " + detail + "\n")
                        if messagebox.askyesno("Instalación completada", f"Treseko está listo en {url}. ¿Abrirlo ahora?"):
                            self._open_url(url)
                    else:
                        self.status_var.set("La instalación terminó, pero la verificación final falló.")
                        messagebox.showerror("Verificación incompleta", detail)
                elif kind == "runtime-detection":
                    data = json.loads(payload)
                    self.runtime_detection = type("RuntimeDetectionView", (), data)()
                    if data.get("state") == "running":
                        self.runtime_state_var.set(f"Versión en ejecución: {data['version']} · Frontend y Backend saludables")
                    elif data.get("state") == "version_mismatch":
                        self.runtime_state_var.set(f"Versiones en ejecución distintas: Frontend {data.get('version')} · Backend {data.get('backend_version')}")
                    elif data.get("state") == "not_running":
                        saved = installed_version(self.installation_root) if self._installation_recognized() else None
                        self.runtime_state_var.set(f"Servicios detenidos · última versión registrada: {saved}" if saved else "Versión en ejecución: no disponible; no hay servicios respondiendo")
                    else:
                        self.runtime_state_var.set(str(data.get("detail") or "No se pudo verificar la versión en ejecución."))
                    self._refresh_mode_controls()
                elif kind in {"install", "bootstrap-error"}:
                    self._set_stage("install" if kind == "install" else "download", "error")
                    self._set_busy(False)
                    self._destructive_install = False
                    self.status_var.set("El proceso no terminó correctamente.")
                    self._write_log("\nERROR:\n" + payload + "\n")
                    messagebox.showerror("No se puede continuar", payload.split("|", 1)[-1])
                elif kind == "cancelled":
                    self._set_stage("download" if "Descarga" in payload else "install", "cancelled")
                    self._set_busy(False)
                    self._destructive_install = False
                    self.status_var.set(payload)
                    self._write_log("\n" + payload + "\n")
                elif kind == "bootstrap":
                    data = json.loads(payload)
                    new_root, gui_path = Path(data["package"]), Path(data["gui"])
                    if not self._is_valid_package(new_root, data["tag"]):
                        raise RuntimeError("El paquete descargado no superó la validación final.")
                    selected_root = self.installation_root if self._installation_recognized() else None
                    recognized_root = self._find_cached_installation()
                    self.repo_root = new_root
                    self.installation_root = selected_root or recognized_root or new_root
                    self.installation_root_var.set(str(self.installation_root))
                    self._refresh_package_state()
                    self._set_stage("download", "done")
                    self._set_busy(False)
                    current_gui = Path(__file__).resolve()
                    if not getattr(sys, "frozen", False) and gui_path.is_file() and not gui_path.is_symlink() and gui_path.resolve().is_relative_to(new_root.resolve()) and gui_path.resolve() != current_gui:
                        try:
                            py_compile.compile(str(gui_path), doraise=True)
                        except (OSError, py_compile.PyCompileError) as exc:
                            raise RuntimeError(f"La GUI descargada no superó la validación de sintaxis: {exc}") from exc
                        config = self._capture_config()
                        args = build_gui_handoff_args(
                            sys.executable,
                            gui_path,
                            new_root,
                            self.installation_root,
                            str(config["port"]),
                            str(config["mode"]),
                            bool(config["demo"]),
                        )
                        self._write_log("\nSe encontró una GUI actualizada. Reiniciando con la misma configuración...\n")
                        subprocess.Popen(args, cwd=str(new_root))
                        self.destroy()
                    else:
                        self.status_var.set("Paquete oficial descargado y validado. Ya podés instalar Treseko.")
                        self._write_log(f"\nPaquete oficial listo en {self.repo_root}\n")
        except queue.Empty:
            pass
        except (OSError, ValueError, RuntimeError) as exc:
            self._set_busy(False)
            messagebox.showerror("Paquete inválido", str(exc))
        self.after(100, self._drain_events)

    @staticmethod
    def _open_url(url: str) -> None:
        if sys.platform == "win32":
            os.startfile(url)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", url])
        else:
            subprocess.Popen(["xdg-open", url])


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Instalador grafico de Treseko")
    parser.add_argument("--package")
    parser.add_argument("--installation-root")
    parser.add_argument("--port", default="9095")
    parser.add_argument("--mode", choices=("new", "update", "uninstall", "reset"), default="new")
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--icon")
    return parser.parse_args()


def main() -> int:
    try:
        app = TresekoInstaller(_parse_args())
    except tk.TclError as exc:
        print(f"No se pudo abrir la interfaz grafica: {exc}", file=sys.stderr)
        print("Instala tkinter y ejecuta el instalador CLI correspondiente.", file=sys.stderr)
        return 1
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
