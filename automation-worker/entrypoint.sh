#!/bin/sh
set -eu

if [ -d /opt/treseko/worker-source ]; then
  cp -a /opt/treseko/worker-source/. /worker/
fi

exec "$@"
