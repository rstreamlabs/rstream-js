#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <candidate> <source-sha>" >&2
  exit 1
fi

candidate=$1
source_sha=$2
release="$candidate/release.json"

if [[ "$(jq -r '.source' "$release")" != "$source_sha" ]]; then
  echo "release candidate source does not match the approved commit" >&2
  exit 1
fi

while IFS= read -r package; do
  name=$(jq -r '.name' <<< "$package")
  version=$(jq -r '.version' <<< "$package")
  tag="${name}@${version}"
  encoded_tag=${tag//\//%2F}
  if tag_ref=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${encoded_tag}" 2>/dev/null); then
    if [[ "$(jq -r '.object.sha' <<< "$tag_ref")" != "$source_sha" ]]; then
      echo "immutable Git tag conflict for ${tag}" >&2
      exit 1
    fi
  else
    gh api --method POST "repos/${GITHUB_REPOSITORY}/git/refs" -f "ref=refs/tags/${tag}" -f "sha=${source_sha}" >/dev/null
  fi
  if gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
    release_target=$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json targetCommitish --jq '.targetCommitish')
    if [[ "$release_target" != "$source_sha" && "$release_target" != "main" ]]; then
      echo "immutable GitHub release conflict for ${tag}" >&2
      exit 1
    fi
  else
    gh release create "$tag" --repo "$GITHUB_REPOSITORY" --target "$source_sha" --title "$tag" --generate-notes
  fi
done < <(jq -c '.packages[]' "$release")
