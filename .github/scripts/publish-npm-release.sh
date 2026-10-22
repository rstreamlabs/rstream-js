#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <candidate>" >&2
  exit 1
fi

candidate=$1
release="$candidate/release.json"

if [[ ! -f "$release" || "$(jq -r '.source' "$release")" != "$(git rev-parse HEAD)" ]]; then
  echo "npm release candidate does not match the checked-out commit" >&2
  exit 1
fi

while IFS= read -r package; do
  name=$(jq -r '.name' <<< "$package")
  version=$(jq -r '.version' <<< "$package")
  archive="$candidate/$(jq -r '.archive' <<< "$package")"
  expected_integrity=$(jq -r '.integrity' <<< "$package")
  actual_integrity="sha512-$(openssl dgst -sha512 -binary "$archive" | openssl base64 -A)"
  if [[ "$actual_integrity" != "$expected_integrity" ]]; then
    echo "candidate integrity mismatch for ${name}@${version}" >&2
    exit 1
  fi
  error_log=$(mktemp)
  if published_integrity=$(npm view "${name}@${version}" dist.integrity 2> "$error_log"); then
    rm -f "$error_log"
  elif grep -Eq 'E404|404 Not Found' "$error_log"; then
    published_integrity=""
    rm -f "$error_log"
  else
    cat "$error_log" >&2
    rm -f "$error_log"
    exit 1
  fi
  if [[ -n "$published_integrity" && "$published_integrity" != "$expected_integrity" ]]; then
    echo "immutable npm conflict for ${name}@${version}" >&2
    exit 1
  fi
  if [[ -z "$published_integrity" ]]; then
    npm publish --access public "$archive"
  fi
  for _ in {1..24}; do
    published_integrity=$(npm view "${name}@${version}" dist.integrity 2>/dev/null || true)
    if [[ "$published_integrity" == "$expected_integrity" ]]; then
      break
    fi
    sleep 5
  done
  if [[ "$published_integrity" != "$expected_integrity" ]]; then
    echo "published npm integrity mismatch for ${name}@${version}" >&2
    exit 1
  fi
done < <(jq -c '.packages[]' "$release")
