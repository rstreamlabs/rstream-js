#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <plan>" >&2
  exit 1
fi

plan=$1
temporary=$(mktemp)
trap 'rm -f "$temporary"' EXIT
jq -n --arg source "$(git rev-parse HEAD)" '{source: $source, packages: []}' > "$plan"

while IFS= read -r manifest; do
  if [[ "$(jq -r '.private // false' "$manifest")" == true ]]; then
    continue
  fi
  name=$(jq -r '.name' "$manifest")
  version=$(jq -r '.version' "$manifest")
  directory=$(dirname "$manifest")
  error_log=$(mktemp)
  if published=$(npm view "${name}@${version}" version --json 2> "$error_log"); then
    if [[ "$(jq -r '.' <<< "$published")" != "$version" ]]; then
      echo "registry returned an unexpected version for ${name}@${version}" >&2
      rm -f "$error_log"
      exit 1
    fi
    rm -f "$error_log"
    continue
  fi
  if ! grep -Eq 'E404|404 Not Found' "$error_log"; then
    cat "$error_log" >&2
    rm -f "$error_log"
    exit 1
  fi
  rm -f "$error_log"
  jq --arg name "$name" --arg version "$version" --arg directory "$directory" \
    '.packages += [{name: $name, version: $version, directory: $directory}]' \
    "$plan" > "$temporary"
  mv "$temporary" "$plan"
done < <(find packages -mindepth 2 -maxdepth 2 -name package.json -print | LC_ALL=C sort)

jq --exit-status '.source != "" and (.packages | all(.name != "" and .version != "" and .directory != ""))' "$plan" >/dev/null
