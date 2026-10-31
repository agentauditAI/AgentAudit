#!/usr/bin/env bash
# Installs the solc binary that contracts/v3/ is pinned to (foundry.toml
# compilation_restrictions, docs/design/AUDITVAULT_V3.md §9) into the svm
# directory that forge reads installed compilers from.
#
# Needed because forge 1.7.1 (pinned in CI) was built before solc 0.8.38 was
# released, so it cannot auto-install it. Upgrading forge instead could change
# its defaults (e.g. evm_version) for the existing, already-deployed contracts.
#
# Binaries and SHA-256 sums: https://binaries.soliditylang.org/<platform>/list.json
set -euo pipefail

VERSION="0.8.38"
LONG_VERSION="0.8.38+commit.1835d247"

case "$(uname -s)" in
  Linux)
    PLATFORM="linux-amd64"
    SHA256="65c3180a336eabb6bdc4bbd49cc405aeb233976964ae6c11fba2a6c8be8f3243"
    DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
    ;;
  Darwin)
    PLATFORM="macosx-amd64" # universal binary (x86_64 + arm64)
    SHA256="b18ac1d1f48394c71ca9aefbf0fb94fef24c87b358f48578de5941e234e0a2a9"
    DATA_DIR="$HOME/Library/Application Support"
    ;;
  *)
    echo "install-solc: unsupported platform $(uname -s)" >&2
    exit 1
    ;;
esac

# Same rule as svm-rs resolve_data_dir(): ~/.svm if it exists or if the
# platform data dir does not exist, otherwise <data dir>/svm
if [ -n "${SVM_DIR:-}" ]; then
  :
elif [ -d "$HOME/.svm" ] || [ ! -d "$DATA_DIR" ]; then
  SVM_DIR="$HOME/.svm"
else
  SVM_DIR="$DATA_DIR/svm"
fi

TARGET="$SVM_DIR/$VERSION/solc-$VERSION"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

if [ -x "$TARGET" ] && [ "$(sha256_of "$TARGET")" = "$SHA256" ]; then
  echo "solc $VERSION already installed at $TARGET"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

URL="https://binaries.soliditylang.org/$PLATFORM/solc-$PLATFORM-v$LONG_VERSION"
curl -fsSL --retry 3 -o "$TMP/solc" "$URL"

ACTUAL="$(sha256_of "$TMP/solc")"
if [ "$ACTUAL" != "$SHA256" ]; then
  echo "install-solc: SHA-256 mismatch for $URL" >&2
  echo "  expected $SHA256" >&2
  echo "  got      $ACTUAL" >&2
  exit 1
fi

mkdir -p "$SVM_DIR/$VERSION"
install -m 0755 "$TMP/solc" "$TARGET"
"$TARGET" --version | tail -1
echo "solc $VERSION installed at $TARGET"
