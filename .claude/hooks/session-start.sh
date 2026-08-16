#!/bin/bash
# SessionStart hook for Claude Code on the web. Installs what the remote
# container is missing: the gh CLI (the kernel's doctor requires it for PR
# modes) and Node 26 for the tiphys CLI, then installs npm dependencies.
# Local sessions are assumed to have their own setup and are skipped.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# gh CLI into ~/.local/bin, pinned, idempotent.
GH_VERSION="2.86.0"
if ! "$HOME/.local/bin/gh" --version >/dev/null 2>&1; then
  mkdir -p "$HOME/.local/bin"
  tmp="$(mktemp -d)"
  curl -sSL -o "$tmp/gh.tar.gz" \
    "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz"
  tar -xzf "$tmp/gh.tar.gz" -C "$tmp"
  cp "$tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" "$HOME/.local/bin/gh"
  rm -rf "$tmp"
fi

# Node 26 via the preinstalled nvm: @tiphys/kernel declares engines.node >=26
# and the container default is 22. Idempotent, nvm skips an installed version.
export NVM_DIR=/opt/nvm
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # nvm.sh is not clean under set -u
  set +u
  . "$NVM_DIR/nvm.sh"
  nvm install 26 >/dev/null 2>&1
  nvm alias default 26 >/dev/null 2>&1
  NODE26_BIN="$(dirname "$(nvm which 26)")"
  set -u
fi

# Persist PATH for the session: gh first, then Node 26 ahead of the default node.
{
  echo 'export PATH="$HOME/.local/bin:$PATH"'
  if [ -n "${NODE26_BIN:-}" ]; then
    echo "export PATH=\"$NODE26_BIN:\$PATH\""
  fi
} >> "$CLAUDE_ENV_FILE"

cd "$CLAUDE_PROJECT_DIR"
npm install
