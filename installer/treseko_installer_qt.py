#!/usr/bin/env python3
"""Qt installer UI shared by Windows and Linux (no Tk runtime)."""

from __future__ import annotations

import json
import os
import platform
import posixpath
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path

from PySide6.QtCore import Qt, QThread, QTimer, Signal
from PySide6.QtGui import QFont, QIcon, QPixmap
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QFileDialog, QFrame, QHBoxLayout,
    QLabel, QLineEdit, QMainWindow, QMessageBox, QProgressBar, QPushButton,
    QRadioButton, QStackedWidget, QTextEdit, QVBoxLayout, QWidget,
)

from installer.compose_bind_compat import persist_compose_bind_address, prepare_compose_bind_address
from installer.release_client import download_verified_artifact, parse_latest_release
from installer.runtime_detection import (
    compare_versions, detect_runtime, has_unfinished_update, installed_version,
    runtime_matches_installation,
)


REPOSITORY = "treseko/treseko-platform"
LATEST_API = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")


class Task(QThread):
    done = Signal(object)
    failed = Signal(str)
    output = Signal(str)

    def __init__(self, operation):
        super().__init__()
        self.operation = operation

    def run(self):
        try:
            self.done.emit(self.operation(self.output.emit))
        except Exception as exc:
            self.failed.emit(str(exc))


class Installer(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Treseko Community Installer")
        self.setMinimumSize(700, 660)
        self.resize(780, 740)
        self.setStyleSheet("""
            QMainWindow, QWidget { background:#f6f8fb; color:#17243b; font-size:14px; }
            QLabel, QRadioButton, QCheckBox { background:transparent; }
            QLabel#title { font-size:25px; font-weight:700; }
            QLabel#muted { color:#596982; }
            QFrame#card { background:white; border:1px solid #dce3ed; border-radius:12px; }
            QPushButton { padding:9px 16px; border:1px solid #cbd5e1; border-radius:7px; background:white; }
            QPushButton#primary { background:#2864dc; color:white; border:0; font-weight:600; }
            QPushButton:disabled { color:#98a2b3; }
            QLineEdit, QComboBox { background:white; border:1px solid #cbd5e1; border-radius:6px; padding:8px; }
            QTextEdit { background:white; border:1px solid #dce3ed; border-radius:8px; font-family:monospace; }
        """)
        self.icon_path = self._icon_path()
        self.release = None
        self.release_version = None
        self.package = None
        self.install_root = Path.home() / "Treseko"
        self.current_step = 0
        self._task = None
        self._build()
        self.refresh()

    def _build(self):
        root = QWidget()
        layout = QVBoxLayout(root)
        layout.setContentsMargins(28, 24, 28, 22)
        header = QHBoxLayout()
        brand = QLabel()
        brand.setAlignment(Qt.AlignmentFlag.AlignCenter)
        brand.setStyleSheet("background:#2864dc;border-radius:12px;padding:8px")
        pixmap = QPixmap(str(self.icon_path))
        if not pixmap.isNull(): brand.setPixmap(pixmap.scaled(38,38,Qt.AspectRatioMode.KeepAspectRatio,Qt.TransformationMode.SmoothTransformation))
        brand.setFixedSize(54,54)
        header.addWidget(brand)
        title = QVBoxLayout()
        name = QLabel("Treseko Community"); name.setObjectName("title")
        title.addWidget(name)
        subtitle = QLabel(f"Instalador para {platform.system()}"); subtitle.setObjectName("muted")
        title.addWidget(subtitle)
        header.addLayout(title); header.addStretch()
        self.version = QLabel("Consultando GitHub…"); self.version.setObjectName("muted")
        header.addWidget(self.version)
        layout.addLayout(header)

        self.steps = QHBoxLayout()
        self.step_labels = []
        for index, text in enumerate(("1  Destino", "2  Componentes", "3  Confirmar")):
            label = QLabel(text); self.step_labels.append(label); self.steps.addWidget(label)
            if index < 2:
                separator = QFrame(); separator.setFrameShape(QFrame.Shape.HLine); self.steps.addWidget(separator, 1)
        layout.addLayout(self.steps)

        self.stack = QStackedWidget(); layout.addWidget(self.stack, 1)
        self._destination_page(); self._components_page(); self._review_page(); self._activity_page()
        footer = QHBoxLayout()
        self.back = QPushButton("Atrás"); self.back.clicked.connect(self.previous); footer.addWidget(self.back)
        footer.addStretch()
        self.check_button = QPushButton("Comprobar de nuevo"); self.check_button.clicked.connect(self.refresh); footer.addWidget(self.check_button)
        self.next = QPushButton("Continuar"); self.next.setObjectName("primary"); self.next.clicked.connect(self.advance); footer.addWidget(self.next)
        layout.addLayout(footer)
        self.setCentralWidget(root)
        if self.icon_path.is_file(): self.setWindowIcon(QIcon(str(self.icon_path)))
        self._show_step(0)

    @staticmethod
    def _icon_path() -> Path:
        if hasattr(sys, "_MEIPASS"):
            return Path(sys._MEIPASS) / "installer" / "treseko-installer.png"
        return Path(__file__).resolve().parent / "treseko-installer.png"

    def _card(self, parent, heading, detail):
        card = QFrame(); card.setObjectName("card")
        box = QVBoxLayout(card); box.setContentsMargins(18, 15, 18, 15)
        title = QLabel(heading); title.setFont(QFont("", 14, QFont.Weight.DemiBold)); box.addWidget(title)
        text = QLabel(detail); text.setObjectName("muted"); text.setWordWrap(True); box.addWidget(text)
        parent.addWidget(card)
        return box

    def _destination_page(self):
        page = QWidget(); box = QVBoxLayout(page); box.setContentsMargins(0,22,0,8); box.setSpacing(14)
        h = QLabel("¿Dónde instalar Treseko?"); h.setObjectName("title"); box.addWidget(h)
        d = QLabel("Elegí el equipo que alojará la aplicación y los servicios base."); d.setObjectName("muted"); box.addWidget(d)
        self.local = QRadioButton("Este equipo · instala aplicación, PostgreSQL, Redis, Engine y Worker")
        self.local.setChecked(True); box.addWidget(self.local)
        self._card(box,"Este equipo","Instala Treseko en este PC y abre la aplicación en el navegador al terminar.")
        self.remote = QRadioButton("Otro equipo Linux por SSH")
        if platform.system() == "Windows":
            self.remote.setEnabled(shutil.which("bash") is not None)
            self.remote.setToolTip("Para instalar por SSH en Windows se necesita Git Bash o WSL.")
        box.addWidget(self.remote)
        self._card(box,"Servidor Linux","Envía el instalador oficial por SSH. Se usa tu clave SSH configurada; no ingreses contraseñas en esta ventana.")
        self.ssh_row = QWidget(); ssh = QHBoxLayout(self.ssh_row); ssh.setContentsMargins(0,0,0,0)
        self.ssh_target = QLineEdit(); self.ssh_target.setPlaceholderText("usuario@servidor")
        self.ssh_port = QLineEdit("22"); self.ssh_port.setMaximumWidth(80)
        self.remote_root = QLineEdit("/opt/treseko-platform")
        self.remote_root.setPlaceholderText("/opt/treseko-platform")
        ssh.addWidget(self.ssh_target, 1); ssh.addWidget(QLabel("Puerto SSH")); ssh.addWidget(self.ssh_port)
        self.ssh_row.setVisible(False); box.addWidget(self.ssh_row)
        remote_root_row = QWidget(); remote_root_layout = QHBoxLayout(remote_root_row); remote_root_layout.setContentsMargins(0,0,0,0)
        remote_root_layout.addWidget(QLabel("Carpeta remota")); remote_root_layout.addWidget(self.remote_root, 1)
        remote_root_row.setVisible(False); box.addWidget(remote_root_row)
        self.remote.toggled.connect(remote_root_row.setVisible)
        self.remote.toggled.connect(self.ssh_row.setVisible)
        self.status = QLabel("Validando el último release y el estado local…"); self.status.setObjectName("muted"); self.status.setWordWrap(True); box.addWidget(self.status)
        box.addStretch(); self.stack.addWidget(page)

    def _components_page(self):
        page = QWidget(); box = QVBoxLayout(page); box.setContentsMargins(0,22,0,8); box.setSpacing(12)
        h = QLabel("Componentes de Treseko"); h.setObjectName("title"); box.addWidget(h)
        d = QLabel("Se instalarán juntos en el equipo seleccionado para que Treseko funcione."); d.setObjectName("muted"); box.addWidget(d)
        for header, detail in [
            ("Aplicación", "Frontend web, Backend/API y autenticación."),
            ("Servicios de datos", "PostgreSQL y Redis, con volúmenes persistentes."),
            ("Motor de IA", "Se inicia en el equipo destino; el proveedor se configura después."),
            ("Worker de automatización", "Se instala en el destino; Community admite un worker."),
        ]: self._card(box, header, detail)
        self.demo = QCheckBox("Incluir datos de demostración")
        box.addWidget(self.demo); box.addStretch(); self.stack.addWidget(page)

    def _review_page(self):
        page = QWidget(); box = QVBoxLayout(page); box.setContentsMargins(0,22,0,8); box.setSpacing(12)
        h = QLabel("Revisá antes de instalar"); h.setObjectName("title"); box.addWidget(h)
        self.mode = QComboBox(); self.mode.addItem("Instalación nueva", "new"); self.mode.addItem("Actualizar instalación existente", "update")
        self.mode.currentIndexChanged.connect(lambda _: self.bind.setEnabled(self.mode.currentData() == "new"))
        box.addWidget(self.mode)
        row = QHBoxLayout(); self.root_input = QLineEdit(str(self.install_root)); self.root_input.setReadOnly(True)
        choose = QPushButton("Elegir carpeta…"); choose.clicked.connect(self.choose_root)
        row.addWidget(self.root_input,1); row.addWidget(choose); box.addLayout(row)
        port_row = QHBoxLayout(); port_row.addWidget(QLabel("Puerto local")); self.port = QLineEdit("9095"); self.port.setMaximumWidth(100); port_row.addWidget(self.port)
        self.bind = QComboBox(); self.bind.addItem("Solo este equipo", "127.0.0.1"); self.bind.addItem("Red local", "0.0.0.0")
        port_row.addSpacing(12); port_row.addWidget(QLabel("Acceso")); port_row.addWidget(self.bind,1); box.addLayout(port_row)
        self.summary = QLabel("Release oficial · Docker Compose · migraciones · usuario inicial")
        self.summary.setObjectName("muted"); self.summary.setWordWrap(True); box.addWidget(self.summary)
        self.activity = QTextEdit(); self.activity.setReadOnly(True); self.activity.setPlaceholderText("La actividad de instalación aparecerá aquí."); box.addWidget(self.activity,1)
        self.progress = QProgressBar(); self.progress.setRange(0,0); self.progress.hide(); box.addWidget(self.progress)
        self.stack.addWidget(page)

    def _activity_page(self):
        page = QWidget(); box = QVBoxLayout(page); box.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.result_title = QLabel("Treseko está listo"); self.result_title.setObjectName("title"); box.addWidget(self.result_title, alignment=Qt.AlignmentFlag.AlignCenter)
        self.result_text = QLabel("La instalación terminó."); self.result_text.setWordWrap(True); self.result_text.setObjectName("muted"); box.addWidget(self.result_text, alignment=Qt.AlignmentFlag.AlignCenter)
        self.result_log = QTextEdit(); self.result_log.setReadOnly(True); self.result_log.setPlaceholderText("La salida del instalador aparecerá aquí."); self.result_log.setMaximumHeight(220); box.addWidget(self.result_log)
        self.open_button = QPushButton("Abrir Treseko"); self.open_button.setObjectName("primary"); self.open_button.clicked.connect(self.open_treseko); box.addWidget(self.open_button, alignment=Qt.AlignmentFlag.AlignCenter)
        self.stack.addWidget(page)

    def _show_step(self, index):
        self.current_step = index; self.stack.setCurrentIndex(index)
        for i, label in enumerate(self.step_labels):
            label.setStyleSheet("font-weight:700;color:#2864dc" if i == index else "color:#596982")
        self.back.setVisible(index > 0 and index < 3)
        self.next.setVisible(index < 2)
        self.check_button.setVisible(index == 0)
        self.next.setEnabled(bool(self.release) and (not self.remote.isChecked() or bool(self.ssh_target.text().strip())))
        if index == 2: self.next.setText("Instalar Treseko")
        else: self.next.setText("Continuar")

    def _latest_release(self):
        req = urllib.request.Request(LATEST_API, headers={"Accept":"application/vnd.github+json", "User-Agent":"Treseko-Installer"})
        with urllib.request.urlopen(req, timeout=20) as response: payload = json.load(response)
        release = parse_latest_release(payload)
        package = self.obtain_package(release)
        return release, package

    def obtain_package(self, release):
        cache = Path.home() / ".cache" / "treseko" / "packages" if platform.system() != "Windows" else Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Treseko" / "packages"
        target = cache / release.tag; cache.mkdir(parents=True, exist_ok=True)
        if (target / "VERSION").is_file(): return target
        staging = Path(tempfile.mkdtemp(prefix=".staging-", dir=cache))
        try:
            archive = staging / "release.zip"
            package_asset = release.artifacts.get("community-package")
            if package_asset:
                download_verified_artifact(package_asset, archive)
            else:
                req = urllib.request.Request(release.archive_url, headers={"User-Agent":"Treseko-Installer"})
                with urllib.request.urlopen(req, timeout=45) as response, archive.open("wb") as out:
                    if response.geturl().split("/")[2] != "api.github.com": raise ValueError("La descarga de GitHub fue redirigida fuera del repositorio oficial.")
                    shutil.copyfileobj(response, out)
            with zipfile.ZipFile(archive) as zf:
                infos = zf.infolist()
                if len(infos) > 20000 or sum(i.file_size for i in infos) > 2 * 1024**3: raise ValueError("El paquete supera los límites de extracción.")
                for info in infos:
                    dest = (staging / "extract" / info.filename).resolve()
                    if not dest.is_relative_to((staging / "extract").resolve()): raise ValueError("El paquete contiene una ruta de extracción no válida.")
                zf.extractall(staging / "extract")
            roots = list((staging / "extract").glob("*/VERSION"))
            if len(roots) != 1: raise ValueError("El release no contiene una raíz de instalación reconocible.")
            source = roots[0].parent
            if source.joinpath("VERSION").read_text().strip() != release.version: raise ValueError("La versión del paquete no coincide con el release.")
            source.rename(target)
            return target
        finally: shutil.rmtree(staging, ignore_errors=True)

    def refresh(self):
        self.status.setText("Consultando release oficial y detectando instalación…")
        self.check_button.setEnabled(False)
        task = Task(self._latest_release); task.done.connect(self._release_ready); task.failed.connect(self._release_failed); task.finished.connect(lambda: self.check_button.setEnabled(True)); self._task = task; task.start()

    def _release_ready(self, result):
        release, package = result
        self.release = release
        self.release_version = release.version
        self.package = package
        self.version.setText(f"v{release.version}")
        package_cache = self.package.parent
        candidates = [self.package, *sorted(package_cache.glob("*"), key=lambda item: item.stat().st_mtime if item.exists() else 0, reverse=True)]
        existing = next((item for item in candidates if item and (item / "compose.production.env").is_file()), None)
        if existing:
            self.install_root = existing
            self.root_input.setText(str(existing))
            self.mode.setCurrentIndex(1)
        else:
            self.install_root = self.package
            self.root_input.setText(str(self.package))
        self.status.setText("Release estable verificado desde treseko/treseko-platform.")
        self._show_step(self.current_step)

    def _release_failed(self, error):
        self.status.setText(f"No se pudo preparar el release oficial: {error}")

    def choose_root(self):
        path = QFileDialog.getExistingDirectory(self, "Elegir raíz de la instalación")
        if path:
            root = Path(path)
            if not (root / "compose.production.env").is_file():
                QMessageBox.warning(self, "Instalación no reconocida", "La carpeta no contiene compose.production.env."); return
            self.install_root = root; self.root_input.setText(path)

    def advance(self):
        if self.current_step < 2: self._show_step(self.current_step + 1); return
        self.begin_install()

    def previous(self): self._show_step(max(0, self.current_step - 1))

    def begin_install(self):
        if self.package is None: return
        try:
            port = int(self.port.text())
            if not 1 <= port <= 65535: raise ValueError
        except ValueError:
            QMessageBox.warning(self, "Puerto inválido", "El puerto debe ser un número entre 1 y 65535."); return
        updating = self.mode.currentData() == "update"
        runtime = detect_runtime(port) if updating or not self.remote.isChecked() else None
        if self.remote.isChecked():
            if updating: QMessageBox.warning(self,"No disponible","La actualización remota se realiza desde el equipo servidor."); return
            target = self.ssh_target.text().strip()
            if not re.fullmatch(r"[A-Za-z0-9._-]+@[A-Za-z0-9.-]+", target): QMessageBox.warning(self,"Destino SSH inválido","Usá usuario@servidor sin contraseña."); return
            remote_root = self.remote_root.text().strip()
            if not posixpath.isabs(remote_root) or remote_root == "/" or "\x00" in remote_root:
                QMessageBox.warning(self,"Carpeta remota inválida","Elegí una carpeta absoluta distinta de la raíz del servidor."); return
            script = self.package / "scripts" / "install_remote_treseko.sh"
            command = ["bash", str(script), target, "--ssh-port", self.ssh_port.text(), "--remote-dir", remote_root, "--http-port", str(port)]
            cwd = self.package; env = os.environ.copy()
        else:
            if not shutil.which("docker"):
                QMessageBox.warning(self,"Docker no encontrado","Instalá Docker Desktop o Docker Engine antes de continuar."); return
            try:
                docker = shutil.which("docker")
                probe = subprocess.run([docker,"compose","version"],capture_output=True,text=True,timeout=20)
                if probe.returncode != 0:
                    QMessageBox.warning(self,"Docker Compose no disponible","Se requiere Docker Compose v2 y el motor Docker iniciado."); return
                engine = subprocess.run([docker,"info"],capture_output=True,text=True,timeout=30)
                if engine.returncode != 0:
                    QMessageBox.warning(self,"Docker no está iniciado","Iniciá Docker Desktop o Docker Engine y volvé a comprobar."); return
            except (OSError, subprocess.TimeoutExpired) as exc:
                QMessageBox.warning(self,"No se pudo validar Docker",str(exc)); return
            if updating:
                if runtime.state not in {"running", "not_running"}:
                    QMessageBox.warning(self,"Instalación ambigua","No se pudo verificar Treseko en el puerto. No se iniciará la actualización."); return
                if runtime.state == "running" and (installed_version(self.install_root) != runtime.version or runtime_matches_installation(port,self.install_root) is not True):
                    QMessageBox.warning(self,"Destino no confirmado","No se pudo demostrar que la instancia activa pertenezca a la carpeta seleccionada."); return
                installed = installed_version(self.install_root)
                if not installed or compare_versions(self.release_version,installed) <= 0:
                    QMessageBox.warning(self,"Versión de destino inválida","La versión disponible no es posterior a la instalación seleccionada."); return
            elif runtime is not None and runtime.state != "not_running":
                QMessageBox.warning(self,"Puerto ocupado","El puerto responde o su estado es ambiguo. No se iniciará una instalación nueva encima."); return
            script = self.package / "scripts" / ("install_local_treseko.ps1" if platform.system() == "Windows" else "install_local_treseko.sh")
            if updating:
                if not (self.install_root / "compose.production.env").is_file(): QMessageBox.warning(self,"Instalación no reconocida","Seleccioná una instalación existente."); return
                if has_unfinished_update(self.install_root): QMessageBox.warning(self,"Actualización pendiente","Reconciliá la actualización anterior antes de continuar."); return
                installed = installed_version(self.install_root)
                if not installed or compare_versions(self.release_version, installed) <= 0: QMessageBox.warning(self,"Versión no válida","La versión de destino debe ser posterior a la instalada."); return
            elif (self.install_root / "compose.production.env").exists(): QMessageBox.warning(self,"Destino ocupado","La raíz ya contiene una instalación. Elegí Actualizar."); return
            try:
                prepare_compose_bind_address(self.package)
            except (OSError, ValueError) as exc: QMessageBox.critical(self,"Paquete incompatible",str(exc)); return
            env = os.environ.copy(); env["TRESEKO_BIND_ADDRESS"] = str(self.bind.currentData())
            if platform.system() == "Windows":
                command = ["powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-File",str(script),"-HttpPort",str(port)]
                if updating: command += ["-Update","-InstallRoot",str(self.install_root)]
                elif self.install_root.resolve() != self.package.resolve(): command += ["-InstallRoot",str(self.install_root)]
                if self.demo.isChecked() and not updating: command.append("-WithDemo")
            else:
                command = ["bash",str(script),"--http-port",str(port)]
                if updating: command += ["--update","--install-root",str(self.install_root)]
                elif self.install_root.resolve() != self.package.resolve(): command += ["--install-root",str(self.install_root)]
                if self.demo.isChecked() and not updating: command.append("--with-demo")
            cwd = self.package
        confirm = QMessageBox.question(self,"Confirmar instalación",f"Se instalará Treseko v{self.release_version} en {target if self.remote.isChecked() else self.install_root}. ¿Continuar?")
        if confirm != QMessageBox.StandardButton.Yes: return
        self._show_step(3); self.progress.show(); self.next.setEnabled(False); self.activity.clear()
        bind_address = str(self.bind.currentData())
        installation_root = self.install_root
        is_remote = self.remote.isChecked()
        def operation(emit):
            emit("Iniciando el instalador oficial…\n")
            process = subprocess.Popen(command,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding="utf-8",errors="replace",bufsize=1)
            for line in process.stdout or ():
                emit(line)
            code = process.wait()
            if code: raise RuntimeError(f"El instalador terminó con código {code}.")
            if not is_remote:
                try: persist_compose_bind_address(installation_root,bind_address)
                except (OSError,ValueError) as exc: emit(f"Advertencia: no se guardó el acceso configurado: {exc}\n")
            return port
        self.result_log.clear()
        task=Task(operation); task.output.connect(self.activity.append); task.output.connect(self.result_log.append); task.done.connect(self._install_done); task.failed.connect(self._install_failed); self._task=task; task.start()

    def _install_done(self, port):
        self.progress.hide(); self.next.setEnabled(True)
        host = self.ssh_target.text().strip().split("@",1)[1] if self.remote.isChecked() else "localhost"
        self.result_text.setText(f"Instalación completada. Abrí Treseko en http://{host}:{port}. Guardá aquí la contraseña temporal mostrada por el instalador.")
        self._show_step(3)

    def _install_failed(self, error):
        self.progress.hide(); self.activity.append(f"\nERROR: {error}"); self.result_log.append(f"\nERROR: {error}"); self.result_title.setText("No se pudo completar la instalación"); self.result_text.setText("Revisá la actividad para ver el detalle. No cierres hasta guardar lo necesario."); self.open_button.hide(); self.next.setEnabled(True)

    def open_treseko(self):
        try:
            port=int(self.port.text())
            host = self.ssh_target.text().strip().split("@",1)[1] if self.remote.isChecked() else "localhost"
            url=f"http://{host}:{port}"
            if platform.system()=="Windows": os.startfile(url)
            elif platform.system()=="Darwin": subprocess.Popen(["open",url])
            else: subprocess.Popen(["xdg-open",url])
        except Exception as exc: QMessageBox.warning(self,"No se pudo abrir Treseko",str(exc))


def main():
    smoke_test = "--smoke-test" in sys.argv
    app=QApplication(sys.argv[:1]); app.setApplicationName("Treseko Installer")
    if smoke_test:
        Installer.refresh = lambda self: None
    window=Installer(); window.show()
    if smoke_test:
        QTimer.singleShot(350, app.quit)
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
