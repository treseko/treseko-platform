#!/bin/sh
set -eu

root="${1:?usage: hash_component_tree.sh DIRECTORY}"
if [ ! -d "$root" ]; then
  echo "component tree does not exist" >&2
  exit 2
fi

(
  cd "$root"
  find . \
    -type d \( -name .git -o -name node_modules -o -name .cache -o -name .state -o -name .pytest_cache \
      -o -name coverage -o -name logs -o -name reports -o -name pending-deliveries \
      -o -name test-results \) -prune -o \
    -type f \( -name .treseko-content-digest -o -name .maintenance \
      -o -name .treseko-update-fence -o -name .treseko-update-draining \
      -o -name .treseko-update-restart -o -name .treseko-runtime-manifest.json \
      -o -name maintenance.html -o -name .runner-token -o -name .runner-token.pairing -o -name .worker-instance-id \
      -o -name .env -o -name '.env.*' \) -prune -o \
    -type f -print | LC_ALL=C sort | while IFS= read -r file; do
      sha256sum "$file"
    done | sha256sum | awk '{print $1}'
)
