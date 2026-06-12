#!/usr/bin/env bash
#
# sync-version.sh — stamp ios/project.yml with versions sourced from
# the repo-root version.json (mirrors the Android `versionName` pattern).
#
# MARKETING_VERSION        ← version.json `.version`
# CURRENT_PROJECT_VERSION  ← $GITHUB_RUN_NUMBER (CI) or 1 (local)
#
# Run this BEFORE `xcodegen generate` so the produced Xcode project (and
# any subsequent `xcodebuild build`) carries the right CFBundleShortVersionString /
# CFBundleVersion. Fastlane lanes call it before their existing
# set_marketing_version / set_build_number helpers.
#
# Usage:
#   ./scripts/sync-version.sh          # stamp ios/project.yml in place
#   ./scripts/sync-version.sh --print  # print resolved values, do not stamp
#
# Safe to run repeatedly; idempotent. Exits non-zero on any failure.

set -euo pipefail

# Resolve repo root: this script lives at ios/scripts/sync-version.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${IOS_DIR}/.." && pwd)"

VERSION_FILE="${REPO_ROOT}/version.json"
PROJECT_YML="${IOS_DIR}/project.yml"

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "sync-version: version.json not found at ${VERSION_FILE}" >&2
  exit 1
fi

if [[ ! -f "${PROJECT_YML}" ]]; then
  echo "sync-version: project.yml not found at ${PROJECT_YML}" >&2
  exit 1
fi

# Extract `.version` from version.json. Prefer jq; fall back to grep+sed
# so the script works on minimal CI images that don't preinstall jq.
if command -v jq >/dev/null 2>&1; then
  MARKETING_VERSION="$(jq -r '.version' "${VERSION_FILE}")"
else
  MARKETING_VERSION="$(grep -E '"version"[[:space:]]*:' "${VERSION_FILE}" \
    | head -n 1 \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi

if [[ -z "${MARKETING_VERSION}" || "${MARKETING_VERSION}" == "null" ]]; then
  echo "sync-version: could not read .version from ${VERSION_FILE}" >&2
  exit 1
fi

# Build number: GitHub Actions run number in CI; "1" locally.
CURRENT_PROJECT_VERSION="${GITHUB_RUN_NUMBER:-1}"

# --print mode: emit shell export lines and stop. Caller can `eval` or
# source this for use in subsequent commands.
if [[ "${1:-}" == "--print" ]]; then
  echo "export MARKETING_VERSION=${MARKETING_VERSION}"
  echo "export CURRENT_PROJECT_VERSION=${CURRENT_PROJECT_VERSION}"
  exit 0
fi

# In-place stamp project.yml. We rewrite every `MARKETING_VERSION:` and
# `CURRENT_PROJECT_VERSION:` line, preserving the original indentation
# (sed capture group keeps leading whitespace). This is idempotent — a
# second run with the same inputs leaves the file unchanged.
TMP="$(mktemp)"
trap 'rm -f "${TMP}"' EXIT

sed -E \
  -e "s/^([[:space:]]*)MARKETING_VERSION:[[:space:]]*.*/\\1MARKETING_VERSION: '${MARKETING_VERSION}'/" \
  -e "s/^([[:space:]]*)CURRENT_PROJECT_VERSION:[[:space:]]*.*/\\1CURRENT_PROJECT_VERSION: '${CURRENT_PROJECT_VERSION}'/" \
  "${PROJECT_YML}" > "${TMP}"

# Sanity check: confirm both keys still present after rewrite.
if ! grep -q "MARKETING_VERSION:" "${TMP}" || ! grep -q "CURRENT_PROJECT_VERSION:" "${TMP}"; then
  echo "sync-version: post-stamp project.yml lost version keys; aborting" >&2
  exit 1
fi

mv "${TMP}" "${PROJECT_YML}"
trap - EXIT

echo "sync-version: stamped ${PROJECT_YML}"
echo "  MARKETING_VERSION       = ${MARKETING_VERSION}"
echo "  CURRENT_PROJECT_VERSION = ${CURRENT_PROJECT_VERSION}"
