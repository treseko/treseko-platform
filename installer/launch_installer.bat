@echo off
setlocal
py "%~dp0treseko_installer_qt.py"
if errorlevel 1 (
  echo No se pudo iniciar el instalador grafico. Verifica Python o usa Docker Desktop.
  pause
)
