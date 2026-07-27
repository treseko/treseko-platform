#!/usr/bin/env bash

# Funciones compartidas por el instalador bare-metal. Este archivo no ejecuta
# cambios al cargarlo para que la deteccion pueda probarse sin privilegios.

treseko_detect_linux_platform() {
  os_release_file="${TRESEKO_OS_RELEASE_FILE:-/etc/os-release}"
  if [ ! -r "$os_release_file" ]; then
    echo "No se puede leer ${os_release_file}; no es posible identificar la distribucion." >&2
    return 1
  fi

  ID=""
  VERSION_ID=""
  # /etc/os-release es un contrato del sistema y solo se carga desde la ruta
  # explicita anterior. En pruebas se usa un archivo temporal controlado.
  # shellcheck disable=SC1090
  . "$os_release_file"

  TRESEKO_DISTRO_ID="${ID,,}"
  TRESEKO_DISTRO_VERSION="${VERSION_ID:-unknown}"
  TRESEKO_DISTRO_MAJOR="${TRESEKO_DISTRO_VERSION%%.*}"
  case "$TRESEKO_DISTRO_MAJOR" in
    ''|*[!0-9]*)
      echo "VERSION_ID invalido en ${os_release_file}: ${TRESEKO_DISTRO_VERSION}" >&2
      return 1
      ;;
  esac

  case "$TRESEKO_DISTRO_ID" in
    ubuntu)
      TRESEKO_LINUX_FAMILY="debian"
      case "$TRESEKO_DISTRO_MAJOR" in
        22|24) ;;
        *)
          echo "Ubuntu ${TRESEKO_DISTRO_VERSION} no esta soportado bare-metal. Usa Ubuntu 22.04/24.04 o Docker." >&2
          return 1
          ;;
      esac
      ;;
    debian)
      TRESEKO_LINUX_FAMILY="debian"
      if [ "$TRESEKO_DISTRO_MAJOR" -lt 12 ] 2>/dev/null; then
        echo "Debian ${TRESEKO_DISTRO_VERSION} no esta soportado bare-metal. Usa Debian 12+ o Docker." >&2
        return 1
      fi
      ;;
    rhel|rocky|almalinux|ol)
      TRESEKO_LINUX_FAMILY="rhel"
      case "$TRESEKO_DISTRO_MAJOR" in
        9|10) ;;
        *)
          echo "${TRESEKO_DISTRO_ID} ${TRESEKO_DISTRO_VERSION} no esta soportado bare-metal. Usa la version 9/10 o Docker." >&2
          return 1
          ;;
      esac
      ;;
    *)
      echo "Distribucion no soportada para bare-metal: ${TRESEKO_DISTRO_ID:-desconocida}. Usa Docker." >&2
      return 1
      ;;
  esac

  export TRESEKO_DISTRO_ID TRESEKO_DISTRO_VERSION TRESEKO_DISTRO_MAJOR TRESEKO_LINUX_FAMILY
}

treseko_select_python() {
  if [ -n "${TRESEKO_PYTHON_BIN:-}" ]; then
    candidates="$TRESEKO_PYTHON_BIN"
  else
    candidates="python3.12 python3.11 python3.10 python3"
  fi

  for candidate in $candidates; do
    if ! command -v "$candidate" >/dev/null 2>&1; then
      continue
    fi
    if "$candidate" -c 'import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] <= (3, 12) else 1)' >/dev/null 2>&1; then
      TRESEKO_PYTHON_BIN="$(command -v "$candidate")"
      export TRESEKO_PYTHON_BIN
      return 0
    fi
  done

  echo "Python 3.10, 3.11 o 3.12 es obligatorio. Instala una version compatible o usa Docker." >&2
  return 1
}

treseko_nginx_configure_paths() {
  case "$TRESEKO_LINUX_FAMILY" in
    debian)
      TRESEKO_NGINX_CONFIG="/etc/nginx/sites-available/treseko"
      TRESEKO_NGINX_ENABLED="/etc/nginx/sites-enabled/treseko"
      ;;
    rhel)
      TRESEKO_NGINX_CONFIG="/etc/nginx/conf.d/treseko.conf"
      TRESEKO_NGINX_ENABLED=""
      ;;
    *)
      echo "Familia Linux no reconocida para nginx: ${TRESEKO_LINUX_FAMILY:-}" >&2
      return 1
      ;;
  esac
  export TRESEKO_NGINX_CONFIG TRESEKO_NGINX_ENABLED
}

treseko_select_nologin_shell() {
  for candidate in /usr/sbin/nologin /sbin/nologin; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  printf '%s' /bin/false
}

treseko_configure_selinux() {
  [ "$TRESEKO_LINUX_FAMILY" = "rhel" ] || return 0
  command -v getenforce >/dev/null 2>&1 || return 0
  [ "$(getenforce)" != "Disabled" ] || return 0

  if ! command -v setsebool >/dev/null 2>&1 || ! command -v semanage >/dev/null 2>&1 || ! command -v restorecon >/dev/null 2>&1; then
    echo "SELinux esta activo: instala policycoreutils-python-utils antes de ejecutar Treseko." >&2
    return 1
  fi

  setsebool -P httpd_can_network_connect 1
  semanage fcontext -a -t httpd_sys_content_t "${INSTALL_DIR}/frontend/html(/.*)?" 2>/dev/null \
    || semanage fcontext -m -t httpd_sys_content_t "${INSTALL_DIR}/frontend/html(/.*)?"
  restorecon -RF "${INSTALL_DIR}/frontend/html"

  if ! semanage port -l | awk '$1 == "http_port_t" { for (i=3; i<=NF; i++) print $i }' | tr ',' '\n' | grep -qx "$FRONTEND_PORT"; then
    semanage port -a -t http_port_t -p tcp "$FRONTEND_PORT" 2>/dev/null \
      || semanage port -m -t http_port_t -p tcp "$FRONTEND_PORT"
  fi
}
