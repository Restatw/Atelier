#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Atelier — Pinata IPFS deploy (via Cloudflare Worker)
# Usage: ./deploy-ipfs.sh
#
# 1. Build
# 2. Upload dist/ to Pinata → CID
# 3. Deploy a Cloudflare Worker that proxies requests to that CID on IPFS
#    (Worker takes priority over Tunnel — site works without your computer on)
# 4. Purge CF cache
#
# Run ./deploy.sh to revert: removes the Worker route, Tunnel resumes.
#
# Required in .env.deploy:
#   PINATA_JWT      — app.pinata.cloud → Developers → API Keys
#   CF_ACCOUNT_ID   — Cloudflare Account ID
#   CF_ZONE_ID      — Cloudflare Zone ID
#   CF_API_TOKEN    — Cloudflare API token with:
#                       Account → Workers Scripts → Edit
#                       Zone    → Workers Routes  → Edit
#                       Zone    → Cache Purge
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -f "$SCRIPT_DIR/.env.deploy" ]] && { set -a; source "$SCRIPT_DIR/.env.deploy"; set +a; }

SITE_DOMAIN="${SITE_DOMAIN:-atelier.re95.org}"
SITE="https://${SITE_DOMAIN}"
WORKER_NAME="${WORKER_NAME:-atelier-ipfs}"
WORKER_ROUTE="${SITE_DOMAIN}/*"

missing=()
[[ -z "${PINATA_JWT:-}"     ]] && missing+=(PINATA_JWT)
[[ -z "${CF_ACCOUNT_ID:-}"  ]] && missing+=(CF_ACCOUNT_ID)
[[ -z "${CF_ZONE_ID:-}"     ]] && missing+=(CF_ZONE_ID)
[[ -z "${CF_API_TOKEN:-}"   ]] && missing+=(CF_API_TOKEN)
if (( ${#missing[@]} )); then
  echo "✗ Missing in .env.deploy: ${missing[*]}"; exit 1
fi

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

# ── 2. Upload dist/ to Pinata ─────────────────────────────────────────────
echo "▶ Uploading dist/ to Pinata..."

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FORM_ARGS=()
while IFS= read -r -d '' f; do
  rel="${f#"$SCRIPT_DIR/dist/"}"
  FORM_ARGS+=(-F "file=@${f};filename=dist/${rel}")
done < <(find "$SCRIPT_DIR/dist" -type f -print0 | sort -z)
FORM_ARGS+=(-F "pinataMetadata={\"name\":\"atelier-${TIMESTAMP}\"};type=application/json")

curl -s -X POST \
  "https://api.pinata.cloud/pinning/pinFileToIPFS" \
  -H "Authorization: Bearer ${PINATA_JWT}" \
  "${FORM_ARGS[@]}" > "$TMP/pinata.json"

NEW_CID=$(python3 - "$TMP/pinata.json" <<'EOF'
import sys, json
with open(sys.argv[1]) as f: d = json.load(f)
if 'IpfsHash' not in d:
    print(f"ERROR: {d}", file=sys.stderr); sys.exit(1)
print(d['IpfsHash'])
EOF
) || { echo "✗ Pinata upload failed:"; cat "$TMP/pinata.json"; exit 1; }

echo "   ✓ CID: $NEW_CID"

# ── 3. Deploy Cloudflare Worker ───────────────────────────────────────────
echo "▶ Deploying Cloudflare Worker → $WORKER_NAME..."

# Worker script: proxies all requests to the pinned IPFS directory on Pinata
cat > "$TMP/worker.js" <<WORKER
const GATEWAY = 'https://gateway.pinata.cloud';
const CID = '${NEW_CID}';

addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

async function handle(req) {
  const url = new URL(req.url);
  let path = url.pathname;

  // Serve index.html for root or extensionless paths (SPA fallback)
  if (path === '/' || (!path.includes('.') && !path.startsWith('/ipfs'))) {
    path = '/index.html';
  }

  const upstream = GATEWAY + '/ipfs/' + CID + path + url.search;
  try {
    return await fetch(upstream, {
      headers: { 'Authorization': 'Bearer ${PINATA_JWT}' },
      cf: { cacheEverything: true, cacheTtl: 3600 }
    });
  } catch (e) {
    return new Response('IPFS gateway error: ' + e.message, { status: 502 });
  }
}
WORKER

curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/javascript" \
  --data-binary "@$TMP/worker.js" \
  > "$TMP/worker_upload.json"

python3 - "$TMP/worker_upload.json" <<'EOF' || {
import sys, json
with open(sys.argv[1]) as f: d = json.load(f)
if not d.get('success'):
    print(f"ERROR: {d}", file=sys.stderr); sys.exit(1)
EOF
  echo "✗ Worker deploy failed:"; cat "$TMP/worker_upload.json"
  echo ""
  echo "  Make sure CF_API_TOKEN has: Account → Workers Scripts → Edit"
  exit 1
}
echo "   ✓ Worker deployed"

# ── 4. Ensure Worker route exists ─────────────────────────────────────────
echo "▶ Checking Worker route..."

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
  echo "   ✓ Route already exists"
else
  curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/workers/routes" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"pattern\":\"${WORKER_ROUTE}\",\"script\":\"${WORKER_NAME}\"}" \
    > "$TMP/route_create.json"

  python3 - "$TMP/route_create.json" <<'EOF' || {
import sys, json
with open(sys.argv[1]) as f: d = json.load(f)
if not d.get('success'):
    print(f"ERROR: {d}", file=sys.stderr); sys.exit(1)
EOF
    echo "✗ Route creation failed:"; cat "$TMP/route_create.json"
    echo "  Make sure CF_API_TOKEN has: Zone → Workers Routes → Edit"; exit 1
  }
  echo "   ✓ Route created"
fi

# ── 5. Purge Cloudflare cache ─────────────────────────────────────────────
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

echo ""
echo "✓ Deploy complete (IPFS) → $SITE"
echo "  CID:  $NEW_CID"
echo "  IPFS: https://gateway.pinata.cloud/ipfs/${NEW_CID}"
echo ""
echo "  To revert to nginx: ./deploy.sh"
