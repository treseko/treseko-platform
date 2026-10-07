#!/usr/bin/env bash
set -euo pipefail

# Regression harness for install_remote_treseko.sh.
#
# The outer test captures ssh/scp and the remote body. The inner tests run that
# body with command shims, so no SSH connection, Docker daemon, package
# manager, systemd service, or persistent volume is touched.

if [ "${TRESEKO_TEST_HELPER:-0}" = "1" ]; then
  helper_name="$(basename "$0")"

  case "$helper_name" in
    ssh)
      printf '%s\n' "$*" >>"${TRESEKO_SSH_COMMAND_LOG:?}"
      if [ "${TRESEKO_TEST_SSH_PREFLIGHT_FAIL:-0}" = "1" ] && [[ "$*" == *"test ! -e"* ]]; then
        exit 1
      fi
      command cat >"${TRESEKO_SSH_STDIN_LOG:?}"
      exit 0
      ;;
    scp)
      printf '%s\n' "$*" >"${TRESEKO_SCP_LOG:?}"
      exit 0
      ;;
    tar)
      printf 'tar %s\n' "$*" >>"${TRESEKO_TAR_LOG:?}"
      if [ "${TRESEKO_TAR_MODE:-outer}" = "remote" ]; then
        exit 0
      fi
      exit 0
      ;;
    id)
      if [ "${1:-}" = "-u" ] && [ "${TRESEKO_ID_MODE:-root}" = "root" ]; then
        printf '0\n'
      else
        printf '1000\n'
      fi
      exit 0
      ;;
    sudo)
      printf '%s\n' "$*" >>"${TRESEKO_SUDO_LOG:?}"
      if [ "$#" -eq 2 ] && [ "$1" = "-n" ] && [ "$2" = "true" ]; then
        [ "${TRESEKO_TEST_SUDO_MODE:-nopasswd}" != "interactive" ] || exit 1
        exit 0
      fi
      if [ "$1" = "-S" ] && [ "$2" = "-p" ] && [ "$4" = "-v" ]; then
        IFS= read -r supplied_password
        [ "$supplied_password" = "${TRESEKO_TEST_SUDO_PASSWORD:-}" ]
        exit $?
      fi
      if [ "$1" = "-S" ] && [ "$2" = "-p" ] && [ "$4" = "env" ]; then
        IFS= read -r supplied_password
        [ "$supplied_password" = "${TRESEKO_TEST_SUDO_PASSWORD:-}" ] || exit 99
        shift 4
        while [ "$#" -gt 0 ] && [ "$1" != "bash" ]; do
          export "$1"
          shift
        done
        [ "$#" -gt 1 ] || exit 97
        TRESEKO_ID_MODE=root exec bash "$2"
      fi
      if [ "${1:-}" = "-n" ] && [ "${2:-}" = "env" ]; then
        shift 2
        while [ "$#" -gt 0 ] && [ "$1" != "bash" ]; do
          export "$1"
          shift
        done
        [ "$#" -gt 1 ] || exit 97
        TRESEKO_ID_MODE=root exec bash "$2"
      fi
      echo "unexpected sudo invocation: $*" >&2
      exit 98
      ;;
    docker)
      printf '%s\n' "$*" >>"${TRESEKO_DOCKER_LOG:?}"
      if [ "${1:-}" = "inspect" ]; then
        case "${3:-}" in
          *State.Health.Status*) printf 'healthy\n' ;;
          *State.Status*) printf 'running\n' ;;
        esac
        exit 0
      fi
      if [ "${1:-}" != "compose" ]; then
        exit 0
      fi
      docker_command="$*"
      case "$docker_command" in
        *" compose version"*)
          printf 'Docker Compose version v2\n'
          ;;
        *" pg_isready "*)
          pg_attempts=0
          if [ -f "${TRESEKO_PG_ATTEMPTS_FILE:?}" ]; then
            pg_attempts="$(<"${TRESEKO_PG_ATTEMPTS_FILE}")"
          fi
          pg_attempts=$((pg_attempts + 1))
          printf '%s\n' "$pg_attempts" >"${TRESEKO_PG_ATTEMPTS_FILE}"
          if [ "$pg_attempts" -lt 3 ]; then
            exit 1
          fi
          ;;
        *" ps -q backend"*)
          printf 'backend-container\n'
          ;;
        *" ps -q automation-worker"*)
          printf 'worker-container\n'
          ;;
      esac
      exit 0
      ;;
    sleep)
      printf '%s\n' "$*" >>"${TRESEKO_SLEEP_LOG:?}"
      exit 0
      ;;
    rm)
      if [ "$#" -eq 2 ] && [ "$1" = "-f" ] && [[ "$2" == */treseko-platform-* ]]; then
        printf '%s\n' "$*" >>"${TRESEKO_RM_LOG:?}"
        exit 0
      fi
      exec /bin/rm "$@"
      ;;
  esac
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="${SCRIPT_DIR}/install_remote_treseko.sh"
TEST_SCRIPT="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/treseko-remote-installer-test.XXXXXX")"
MOCK_BIN="${TEST_TMP}/bin"
ORIGINAL_PATH="${PATH}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local text="$2"
  grep -F -- "$text" "$file" >/dev/null || fail "${file} no contiene: ${text}"
}

assert_file_not_contains() {
  local file="$1"
  local text="$2"
  if grep -F -- "$text" "$file" >/dev/null; then
    fail "${file} contiene inesperadamente: ${text}"
  fi
}

assert_file_mode() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file")"
  [ "$actual" = "$expected" ] || fail "modo de ${file}: esperado ${expected}, obtenido ${actual}"
}

assert_file_content() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(<"$file")"
  [ "$actual" = "$expected" ] || fail "contenido inesperado en ${file}"
}

cleanup() {
  PATH="$ORIGINAL_PATH"
  /bin/rm -rf "$TEST_TMP"
}
trap cleanup EXIT

mkdir -p "$MOCK_BIN"
for helper in ssh scp tar id sudo docker sleep rm; do
  ln -s "$TEST_SCRIPT" "${MOCK_BIN}/${helper}"
done

REMOTE_BODY="${TEST_TMP}/remote-body.sh"
awk '
  index($0, "<<'"'"'REMOTE_BODY'"'"'") { capture=1; next }
  capture && /^REMOTE_BODY$/ { exit }
  capture { print }
' "$INSTALLER" >"$REMOTE_BODY"
chmod 0700 "$REMOTE_BODY"

echo "1/6 cuerpo remoto materializado antes de ejecutarse"
OUTER_COMMAND_LOG="${TEST_TMP}/ssh-command.log"
OUTER_STDIN_LOG="${TEST_TMP}/ssh-stdin.log"
SCP_LOG="${TEST_TMP}/scp.log"
TAR_LOG="${TEST_TMP}/outer-tar.log"
PATH="${MOCK_BIN}:${ORIGINAL_PATH}" \
  TRESEKO_TEST_HELPER=1 \
  TRESEKO_SSH_COMMAND_LOG="$OUTER_COMMAND_LOG" \
  TRESEKO_SSH_STDIN_LOG="$OUTER_STDIN_LOG" \
  TRESEKO_SCP_LOG="$SCP_LOG" \
  TRESEKO_TAR_LOG="$TAR_LOG" \
  TRESEKO_TAR_MODE=outer \
  "$INSTALLER" qa@example.test --remote-dir "${TEST_TMP}/outer-install" \
  >"${TEST_TMP}/outer-output.log" 2>&1
assert_file_contains "$OUTER_COMMAND_LOG" "bash -c"
assert_file_contains "$OUTER_COMMAND_LOG" 'remote_script=$(mktemp)'
assert_file_contains "$OUTER_COMMAND_LOG" 'cat >$remote_script'
assert_file_contains "$OUTER_COMMAND_LOG" 'bash $remote_script'
assert_file_not_contains "$OUTER_COMMAND_LOG" "bash -s"
assert_file_contains "$OUTER_STDIN_LOG" "set -euo pipefail"
assert_file_contains "$REMOTE_BODY" "exec sudo -n env"

echo "2/6 destino ocupado rechazado antes de empaquetar"
PREFLIGHT_TAR_LOG="${TEST_TMP}/preflight-tar.log"
PREFLIGHT_OUTPUT="${TEST_TMP}/preflight-output.log"
if PATH="${MOCK_BIN}:${ORIGINAL_PATH}" \
  TRESEKO_TEST_HELPER=1 TRESEKO_TEST_SSH_PREFLIGHT_FAIL=1 \
  TRESEKO_SSH_COMMAND_LOG="${TEST_TMP}/preflight-ssh.log" \
  TRESEKO_SSH_STDIN_LOG="${TEST_TMP}/preflight-stdin.log" \
  TRESEKO_SCP_LOG="${TEST_TMP}/preflight-scp.log" \
  TRESEKO_TAR_LOG="$PREFLIGHT_TAR_LOG" \
  "$INSTALLER" qa@example.test --remote-dir "${TEST_TMP}/occupied" \
  >"$PREFLIGHT_OUTPUT" 2>&1; then
  fail "la prevalidacion acepto un destino ocupado"
fi
assert_file_not_contains "$PREFLIGHT_OUTPUT" "Preparando paquete local"
test ! -e "$PREFLIGHT_TAR_LOG" || fail "se empaqueto antes de rechazar el destino"
test ! -e "${TEST_TMP}/preflight-scp.log" || fail "se subio un paquete a un destino ocupado"

echo "3/6 extracción sin owner/permisos heredados"
assert_file_contains "$REMOTE_BODY" "--no-same-owner --no-same-permissions -xzf"
assert_file_contains "$INSTALLER" "tar --no-xattrs"
assert_file_contains "$TAR_LOG" "tar --no-xattrs"

run_remote_body() {
  local id_mode="$1"
  local remote_dir="$2"
  local output="$3"
  local sudo_log="$4"
  local docker_log="$5"
  local pg_attempts_file="$6"
  local sleep_log="$7"
  local tar_log="$8"
  local rm_log="$9"
  local sudo_password="${10:-}"

  TRESEKO_TEST_HELPER=1 \
  TRESEKO_ID_MODE="$id_mode" \
  TRESEKO_TAR_MODE=remote \
  TRESEKO_REMOTE_DIR="$remote_dir" \
  TRESEKO_REMOTE_ARCHIVE="/tmp/treseko-platform-test.tgz" \
  TRESEKO_HTTP_PORT=19095 \
  TRESEKO_INSTALL_DOCKER=false \
  TRESEKO_WORKER_BROWSERS="chromium" \
  TRESEKO_WORKER_INSTALL_CYPRESS=false \
  TRESEKO_WORKER_INSTALL_PUPPETEER=false \
  TRESEKO_DB_PASSWORD="db-pass-exact" \
  TRESEKO_SECRET_KEY="secret-key-exact" \
  TRESEKO_AI_CREDENTIALS_MASTER_KEY="ai-master-exact" \
  TRESEKO_AI_ENGINE_INTERNAL_TOKEN="engine-token-exact" \
  TRESEKO_ADMIN_PASSWORD="admin-pass-exact" \
  TRESEKO_SUDO_PASSWORD="$sudo_password" \
  TRESEKO_TEST_SUDO_PASSWORD="$sudo_password" \
  TRESEKO_SUDO_LOG="$sudo_log" \
  TRESEKO_DOCKER_LOG="$docker_log" \
  TRESEKO_PG_ATTEMPTS_FILE="$pg_attempts_file" \
  TRESEKO_SLEEP_LOG="$sleep_log" \
  TRESEKO_TAR_LOG="$tar_log" \
  TRESEKO_RM_LOG="$rm_log" \
  PATH="${MOCK_BIN}:${ORIGINAL_PATH}" \
  bash "$REMOTE_BODY" >"$output" 2>&1
}

prepare_remote_dir() {
  local remote_dir="$1"
  mkdir -p "$remote_dir"
  chmod 0700 "$remote_dir"
}

ROOT_REMOTE_DIR="${TEST_TMP}/root-install"
ROOT_SUDO_LOG="${TEST_TMP}/root-sudo.log"
ROOT_DOCKER_LOG="${TEST_TMP}/root-docker.log"
ROOT_PG_ATTEMPTS="${TEST_TMP}/root-pg-attempts"
ROOT_SLEEP_LOG="${TEST_TMP}/root-sleep.log"
ROOT_TAR_LOG="${TEST_TMP}/root-tar.log"
ROOT_RM_LOG="${TEST_TMP}/root-rm.log"
prepare_remote_dir "$ROOT_REMOTE_DIR"

echo "4/6 espera de pg_isready y secretos exactos"
run_remote_body root "$ROOT_REMOTE_DIR" "${TEST_TMP}/root-output.log" \
  "$ROOT_SUDO_LOG" "$ROOT_DOCKER_LOG" "$ROOT_PG_ATTEMPTS" "$ROOT_SLEEP_LOG" \
  "$ROOT_TAR_LOG" "$ROOT_RM_LOG"

[ "$(<"$ROOT_PG_ATTEMPTS")" = "3" ] || fail "pg_isready no reintentó hasta estar listo"
[ "$(wc -l <"$ROOT_SLEEP_LOG" | tr -d ' ')" = "2" ] || fail "la espera de PostgreSQL no tuvo dos pausas"
assert_file_contains "$ROOT_DOCKER_LOG" "compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis"
assert_file_contains "$ROOT_DOCKER_LOG" "compose -f docker-compose.prod.yml --env-file compose.production.env exec -T -u postgres db pg_isready -U treseko -d treseko"
assert_file_contains "$ROOT_TAR_LOG" "tar --no-same-owner --no-same-permissions -xzf /tmp/treseko-platform-test.tgz"

up_line="$(grep -n -- " up -d db redis" "$ROOT_DOCKER_LOG" | head -n 1 | cut -d: -f1)"
ready_line="$(grep -n -- " pg_isready -U treseko -d treseko" "$ROOT_DOCKER_LOG" | head -n 1 | cut -d: -f1)"
[ "$up_line" -lt "$ready_line" ] || fail "pg_isready no se ejecutó después de iniciar PostgreSQL"

secret_dir="${ROOT_REMOTE_DIR}/secrets"
for secret_name in db-password database-url secret-key ai-credentials-master-key ai-engine-internal-token admin-password; do
  assert_file_mode "${secret_dir}/${secret_name}" 600
done
assert_file_content "${secret_dir}/db-password" "db-pass-exact"
assert_file_content "${secret_dir}/database-url" "postgresql+asyncpg://treseko:db-pass-exact@db:5432/treseko"
assert_file_content "${secret_dir}/secret-key" "secret-key-exact"
assert_file_content "${secret_dir}/ai-credentials-master-key" "ai-master-exact"
assert_file_content "${secret_dir}/ai-engine-internal-token" "engine-token-exact"
assert_file_content "${secret_dir}/admin-password" "admin-pass-exact"

echo "5/6 elevación sin contraseña y limpieza sin volúmenes"
ESCALATED_REMOTE_DIR="${TEST_TMP}/escalated-install"
ESCALATED_SUDO_LOG="${TEST_TMP}/escalated-sudo.log"
ESCALATED_DOCKER_LOG="${TEST_TMP}/escalated-docker.log"
ESCALATED_PG_ATTEMPTS="${TEST_TMP}/escalated-pg-attempts"
ESCALATED_SLEEP_LOG="${TEST_TMP}/escalated-sleep.log"
ESCALATED_TAR_LOG="${TEST_TMP}/escalated-tar.log"
ESCALATED_RM_LOG="${TEST_TMP}/escalated-rm.log"
prepare_remote_dir "$ESCALATED_REMOTE_DIR"
run_remote_body nonroot "$ESCALATED_REMOTE_DIR" "${TEST_TMP}/escalated-output.log" \
  "$ESCALATED_SUDO_LOG" "$ESCALATED_DOCKER_LOG" "$ESCALATED_PG_ATTEMPTS" \
  "$ESCALATED_SLEEP_LOG" "$ESCALATED_TAR_LOG" "$ESCALATED_RM_LOG"

[ "$(grep -c -- '-n env' "$ESCALATED_SUDO_LOG" || true)" = "1" ] || fail "no hubo una única transferencia de ejecución a root"
assert_file_contains "$ESCALATED_SUDO_LOG" "-n true"
assert_file_not_contains "$ESCALATED_SUDO_LOG" "-S -v"
assert_file_not_contains "$ESCALATED_DOCKER_LOG" "volume"
assert_file_not_contains "$ESCALATED_DOCKER_LOG" " down"
assert_file_not_contains "$REMOTE_BODY" "docker volume prune"
assert_file_not_contains "$REMOTE_BODY" "docker compose down"
assert_file_not_contains "$REMOTE_BODY" "--volumes"
assert_file_contains "$REMOTE_BODY" "docker builder prune -af"
assert_file_contains "$REMOTE_BODY" "docker image prune -f"
assert_file_contains "$REMOTE_BODY" 'SUDO=""'

echo "6/6 elevación con contraseña por stdin"
PASSWORD_REMOTE_DIR="${TEST_TMP}/password-install"
PASSWORD_SUDO_LOG="${TEST_TMP}/password-sudo.log"
PASSWORD_DOCKER_LOG="${TEST_TMP}/password-docker.log"
PASSWORD_PG_ATTEMPTS="${TEST_TMP}/password-pg-attempts"
PASSWORD_SLEEP_LOG="${TEST_TMP}/password-sleep.log"
PASSWORD_TAR_LOG="${TEST_TMP}/password-tar.log"
PASSWORD_RM_LOG="${TEST_TMP}/password-rm.log"
prepare_remote_dir "$PASSWORD_REMOTE_DIR"
TRESEKO_TEST_SUDO_MODE=interactive \
run_remote_body nonroot "$PASSWORD_REMOTE_DIR" "${TEST_TMP}/password-output.log" \
  "$PASSWORD_SUDO_LOG" "$PASSWORD_DOCKER_LOG" "$PASSWORD_PG_ATTEMPTS" \
  "$PASSWORD_SLEEP_LOG" "$PASSWORD_TAR_LOG" "$PASSWORD_RM_LOG" "qa-password"
[ "$(<"$PASSWORD_PG_ATTEMPTS")" = "3" ] || fail "sudo con contraseña no continuó el flujo remoto"
assert_file_contains "$PASSWORD_SUDO_LOG" "-S -p  -v"
assert_file_contains "$PASSWORD_SUDO_LOG" "-S -p  env"
assert_file_not_contains "$PASSWORD_SUDO_LOG" "qa-password"

echo "PASS: regresión enfocada de install_remote_treseko.sh"
