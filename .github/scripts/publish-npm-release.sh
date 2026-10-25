#!/usr/bin/env bash

set -euo pipefail

read_published_integrity() {
  local error_log integrity
  error_log=$(mktemp)
  if integrity=$(npm view "$1" dist.integrity --prefer-online 2> "$error_log"); then
    rm -f "$error_log"
    printf '%s' "$integrity"
  elif grep -Eq 'E404|404 Not Found' "$error_log"; then
    rm -f "$error_log"
  else
    cat "$error_log" >&2
    rm -f "$error_log"
    return 1
  fi
}

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

ordered=$(mktemp)
trap 'rm -f "$ordered"' EXIT
node .github/scripts/order-npm-release.mjs "$release" > "$ordered"

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
  published_integrity=$(read_published_integrity "${name}@${version}")
  if [[ -n "$published_integrity" && "$published_integrity" != "$expected_integrity" ]]; then
    echo "immutable npm conflict for ${name}@${version}" >&2
    exit 1
  fi
  if [[ -z "$published_integrity" ]]; then
    npm publish --access public "$archive"
  fi
  delay=2
  for attempt in {1..40}; do
    published_integrity=$(read_published_integrity "${name}@${version}")
    if [[ -n "$published_integrity" ]]; then
      break
    fi
    if [[ "$attempt" -lt 40 ]]; then
      sleep "$delay"
      delay=$((delay < 8 ? delay * 2 : 15))
    fi
  done
  if [[ -z "$published_integrity" ]]; then
    echo "published npm package did not become visible for ${name}@${version}; retry promotion from the same candidate" >&2
    exit 1
  fi
  if [[ "$published_integrity" != "$expected_integrity" ]]; then
    echo "published npm integrity mismatch for ${name}@${version}" >&2
    exit 1
  fi
done < "$ordered"
