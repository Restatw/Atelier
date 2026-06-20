#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Atelier — nginx / Cloudflare Tunnel deploy
# Usage: ./deploy.sh
#
# Builds, copies to nginx, removes the IPFS Worker route if present
# (so traffic returns to Cloudflare Tunnel → localhost:80), purges CF cache.
#
# Required in .env.deploy:
#   CF_ZONE_ID   — Cloudflare Zone ID
#   CF_API_TOKEN — Cloudflare API token with:
#                    Zone → Workers Routes → Edit
#                    Zone → Cache Purge
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -f "$SCRIPT_DIR/.env.deploy" ]] && { set -a; source "$SCRIPT_DIR/.env.deploy"; set +a; }

SITE_DOMAIN="${SITE_DOMAIN:-atelier.re95.org}"
SITE="https://${SITE_DOMAIN}"
WEB_ROOT="${NGINX_WEB_ROOT:-/var/www/${SITE_DOMAIN}}"
WORKER_ROUTE="${SITE_DOMAIN}/*"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# ── 1. Build ──────────────────────────────────────────────────────────────
echo "▶ Building..."
cd "$SCRIPT_DIR"
if ! command -v npm &>/dev/null; then
  export NVM_DIR="$HOME/.nvm"
  [[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh"
fi
npm run build
echo "   ✓ Build complete"

# ── 2. Deploy to nginx ────────────────────────────────────────────────────
echo "▶ Deploying to $WEB_ROOT..."
sudo find "$WEB_ROOT/assets" -type f -delete 2>/dev/null || true
sudo cp -r dist/. "$WEB_ROOT/"
echo "   ✓ Done"

# ── 3. Remove IPFS Worker route → restore Tunnel ──────────────────────────
if [[ -n "${CF_ZONE_ID:-}" && -n "${CF_API_TOKEN:-}" ]]; then
  echo "▶ Checking for active IPFS Worker route..."

  curl -s "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" > "$TMP/routes.json"

  ROUTE_ID=$(python3 - "$TMP/routes.json" "$WORKER_ROUTE" <<'EOF'
import sys, json
with open(sys.argv[1]) as f: data = json.load(f)
for r in data.get('result', []):
    if r.get('pattern') == sys.argv[2]:
        print(r['id']); sys.exit(0)
EOF
  )

  if [[ -n "$ROUTE_ID" ]]; then
    curl -s -X DELETE \
      "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes/${ROUTE_ID}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" > "$TMP/route_del.json"

    if python3 -c "import json,sys; d=json.load(open('$TMP/route_del.json')); sys.exit(0 if d.get('success') else 1)" 2>/dev/null; then
      echo "   ✓ Worker route removed → Tunnel is now active"
    else
      echo "⚠  Failed to remove Worker route:"; cat "$TMP/route_del.json"
    fi
  else
    echo "   ✓ Tunnel already active (no Worker route present)"
  fi
fi

# ── 4. Purge Cloudflare cache ─────────────────────────────────────────────
if [[ -n "${CF_ZONE_ID:-}" && -n "${CF_API_TOKEN:-}" ]]; then
  echo "▶ Purging Cloudflare cache..."
  curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"files\":[\"${SITE}/\",\"${SITE}/index.html\",\"${SITE}/sw.js\",\"${SITE}/registerSW.js\",\"${SITE}/manifest.webmanifest\"]}" \
    > "$TMP/cf_purge.json"

  if python3 -c "import json,sys; d=json.load(open('$TMP/cf_purge.json')); sys.exit(0 if d.get('success') else 1)" 2>/dev/null; then
    echo "   ✓ Cache purged"
  else
    echo "⚠  Cache purge may have failed:"; cat "$TMP/cf_purge.json"
  fi
fi

echo ""
echo "✓ Deploy complete (nginx/tunnel) → $SITE"
echo ""
echo "  To switch to IPFS: ./deploy-ipfs.sh"
