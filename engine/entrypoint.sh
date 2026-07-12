#!/bin/sh
set -eu

if [ -d /opt/treseko/engine-source ]; then
  cp -a /opt/treseko/engine-source/. /engine/
fi

exec "$@"
