#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <plan> <destination>" >&2
  exit 1
fi

plan=$1
destination=$2
temporary=$(mktemp)
trap 'rm -f "$temporary"' EXIT

if [[ "$(jq -r '.source' "$plan")" != "$(git rev-parse HEAD)" ]]; then
  echo "release plan does not match the current commit" >&2
  exit 1
fi

if [[ -e "$destination" ]]; then
  echo "candidate destination already exists: ${destination}" >&2
  exit 1
fi
mkdir -p "$destination/packages"
jq '{schema: 1, source, packages: []}' "$plan" > "$destination/release.json"

while IFS= read -r package; do
  name=$(jq -r '.name' <<< "$package")
  version=$(jq -r '.version' <<< "$package")
  directory=$(jq -r '.directory' <<< "$package")
  if [[ "$directory" != packages/* || "$directory" == *..* ]]; then
    echo "invalid package directory for ${name}@${version}" >&2
    exit 1
  fi
  packed=$(npm pack "./$directory" --ignore-scripts --json --pack-destination "$destination/packages")
  filename=$(jq -r 'if length == 1 then .[0].filename else empty end' <<< "$packed")
  if [[ -z "$filename" || ! -f "$destination/packages/$filename" ]]; then
    echo "npm did not create one archive for ${name}@${version}" >&2
    exit 1
  fi
  archive="packages/${filename}"
  integrity="sha512-$(openssl dgst -sha512 -binary "$destination/$archive" | openssl base64 -A)"
  jq --arg name "$name" --arg version "$version" --arg directory "$directory" --arg archive "$archive" --arg integrity "$integrity" \
    '.packages += [{name: $name, version: $version, directory: $directory, archive: $archive, integrity: $integrity}]' \
    "$destination/release.json" > "$temporary"
  mv "$temporary" "$destination/release.json"
done < <(jq -c '.packages[]' "$plan")

if [[ "$(jq '.packages | length' "$destination/release.json")" == 0 ]]; then
  echo "release plan contains no unpublished packages" >&2
  exit 1
fi

(
  cd "$destination"
  checksum_manifest=$(mktemp)
  find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > "$checksum_manifest"
  mv "$checksum_manifest" SHA256SUMS
  sha256sum --check SHA256SUMS
)
