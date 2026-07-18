#!/usr/bin/env bash
# Build and publish python/ts runtime + codegen packages.
# usage: ./deploy.sh              deploy current version
#        ./deploy.sh --bump X.Y.Z bump version then deploy
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PY_RUNTIME="$ROOT/python/proto4webrtc"
PY_CODEGEN="$ROOT/python/proto4webrtc_codegen"
TS_RUNTIME="$ROOT/ts/proto4webrtc"
TS_CODEGEN="$ROOT/ts/proto4webrtc_codegen"

current_py_version() {
  grep -E '^version = ' "$1/pyproject.toml" | head -n1 | sed -E 's/version = "(.*)"/\1/'
}

current_ts_version() {
  grep -E '"version":' "$1/package.json" | head -n1 | sed -E 's/.*"version": *"([^"]+)".*/\1/'
}

semver_lt() {
  # returns 0 (true) if $1 < $2
  [[ "$1" == "$2" ]] && return 1
  local lower
  lower="$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)"
  [[ "$lower" == "$1" ]]
}

if [[ $# -eq 0 ]]; then
  : # deploy current version, no bump
elif [[ $# -eq 2 && "$1" == "--bump" ]]; then
  VERSION="$2"

  if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
    echo "error: version '$VERSION' is not valid semver" >&2
    exit 1
  fi

  for dir in "$PY_RUNTIME" "$PY_CODEGEN" "$TS_RUNTIME" "$TS_CODEGEN"; do
    if [[ "$dir" == "$PY_RUNTIME" || "$dir" == "$PY_CODEGEN" ]]; then
      current="$(current_py_version "$dir")"
    else
      current="$(current_ts_version "$dir")"
    fi
    if ! semver_lt "$current" "$VERSION"; then
      echo "error: new version $VERSION must be greater than current version $current in $dir" >&2
      exit 1
    fi
  done

  echo "== bumping versions to $VERSION =="

  sed -i -E "s/^version = \"[^\"]+\"/version = \"$VERSION\"/" "$PY_RUNTIME/pyproject.toml"
  sed -i -E "s/proto4webrtc-codegen==[0-9.]+/proto4webrtc-codegen==$VERSION/" "$PY_RUNTIME/pyproject.toml"
  sed -i -E "s/^version = \"[^\"]+\"/version = \"$VERSION\"/" "$PY_CODEGEN/pyproject.toml"

  npm --prefix "$TS_RUNTIME" version "$VERSION" --no-git-tag-version --allow-same-version
  npm --prefix "$TS_CODEGEN" version "$VERSION" --no-git-tag-version --allow-same-version
else
  echo "usage: $0 [--bump <version>]" >&2
  echo "current version: $(current_py_version "$PY_RUNTIME")" >&2
  exit 1
fi

DEPLOY_VERSION="$(current_py_version "$PY_RUNTIME")"

echo "== checking publish credentials =="
has_pypi_token() {
  [[ -n "${POETRY_PYPI_TOKEN_PYPI:-}" ]] && return 0
  # plaintext store (containers / no keyring)
  grep -qs 'pypi-token' "${XDG_CONFIG_HOME:-$HOME/.config}/pypoetry/auth.toml" && return 0
  # system keyring
  python3 - <<'EOF' 2>/dev/null
import sys, keyring
sys.exit(0 if keyring.get_password("poetry-repository-pypi", "__token__") else 1)
EOF
}

if ! has_pypi_token; then
  echo "error: no PyPI credentials. Set POETRY_PYPI_TOKEN_PYPI or run: poetry config pypi-token.pypi <token>" >&2
  exit 1
fi
if ! npm whoami &>/dev/null; then
  echo "error: not logged in to npm. Run: npm login" >&2
  exit 1
fi

echo "== setting up python venv =="
VENV="$ROOT/python/.venv"
python3 -m venv --clear "$VENV"
# unset PYTHONPATH so a sourced ROS/other env can't leak packages into pip or pytest
env -u PYTHONPATH "$VENV/bin/pip" install --upgrade pip
env -u PYTHONPATH "$VENV/bin/pip" install -e "$PY_CODEGEN" -e "$PY_RUNTIME[test]"

echo "== building python packages =="
(cd "$PY_CODEGEN" && poetry build)
(cd "$PY_RUNTIME" && poetry build)

echo "== building ts packages =="
(cd "$TS_CODEGEN" && npm install)
(cd "$TS_RUNTIME" && npm install && npm run build)

echo "== running tests =="
(cd "$PY_RUNTIME" && env -u PYTHONPATH "$VENV/bin/python" -m pytest)
(cd "$TS_RUNTIME" && npm test)

echo "== publishing python packages =="
(cd "$PY_CODEGEN" && poetry publish)
(cd "$PY_RUNTIME" && poetry publish)

echo "== publishing ts packages =="
(cd "$TS_CODEGEN" && npm publish --access public)
(cd "$TS_RUNTIME" && npm publish --access public)

echo "== done: published version $DEPLOY_VERSION =="
