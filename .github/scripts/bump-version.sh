#!/usr/bin/env bash
# Usage: bump-version.sh <before-sha> <after-sha>
# Picks major/minor/patch from the commits in before..after, rewrites the desktop app version
# in tauri.conf.json, Cargo.toml and Cargo.lock, and prints the new version.
#   major: "BREAKING CHANGE" in a message, or a "type!:" subject
#   minor: a subject starting with feat, Add or Phase
#   patch: everything else
set -euo pipefail
before=$1 after=$2
tauri=apps/desktop/src-tauri
if [[ $before =~ ^0+$ ]] || ! git cat-file -e "$before^{commit}" 2>/dev/null; then
	range="$after -1"
else
	range="$before..$after"
fi
# shellcheck disable=SC2086
subjects=$(git log --format=%s $range)
bodies=$(git log --format=%b $range)

level=patch
if grep -qE '^(feat|Add|Phase)\b' <<<"$subjects"; then level=minor; fi
if grep -qE '^[a-z]+(\([^)]*\))?!:' <<<"$subjects" || grep -q 'BREAKING CHANGE' <<<"$bodies"; then level=major; fi

current=$(sed -nE 's/^[[:space:]]*"version": "([0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' $tauri/tauri.conf.json | head -1)
IFS=. read -r maj min pat <<<"$current"
case $level in
	major) next="$((maj + 1)).0.0" ;;
	minor) next="$maj.$((min + 1)).0" ;;
	patch) next="$maj.$min.$((pat + 1))" ;;
esac

sed -i -E "0,/\"version\": \"[0-9.]+\"/s//\"version\": \"$next\"/" $tauri/tauri.conf.json
sed -i -E "0,/^version = \"[0-9.]+\"/s//version = \"$next\"/" $tauri/Cargo.toml
sed -i -E "/^name = \"seijaku-desktop\"/{n;s/^version = \".*\"/version = \"$next\"/}" $tauri/Cargo.lock
echo "$level $current -> $next" >&2
echo "$next"
