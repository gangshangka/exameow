#!/bin/bash
set -e

echo "=== Exameow Cloudflare Deploy ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Step 1: Build frontend for Cloudflare
echo "[1/3] Building frontend for Cloudflare..."
cd "$PROJECT_DIR/frontend"

VITE_CLOUDFLARE=true npx vite build
echo "  Frontend built successfully."

# Step 2: Copy frontend dist to worker public directory
echo ""
echo "[2/3] Copying frontend to worker..."
cd "$PROJECT_DIR/workers"
rm -rf public
mkdir -p public
cp -R "$PROJECT_DIR/frontend/dist/"* public/
rm -rf public/ocr
rm -f public/assets/ort-wasm-simd-threaded*
echo "  Removed local OCR assets (CF uses CDN)."
echo "  Files copied to workers/public/"

# Step 2.1: Copy CF-only SEO files (if present)
echo ""
echo "[2.1/3] Copying CF SEO files..."
if [ -d "$PROJECT_DIR/scripts/cf-seo" ]; then
  cp "$PROJECT_DIR/scripts/cf-seo/robots.txt" public/ 2>/dev/null || true
  cp "$PROJECT_DIR/scripts/cf-seo/llms.txt" public/ 2>/dev/null || true
  cp "$PROJECT_DIR/scripts/cf-seo/pricing.md" public/ 2>/dev/null || true
  if [ -f "$PROJECT_DIR/scripts/cf-seo/okf/index.md" ]; then
    mkdir -p public/okf
    cp "$PROJECT_DIR/scripts/cf-seo/okf/index.md" public/okf/
  fi
  cp "$PROJECT_DIR/scripts/cf-seo/sitemap.xml" public/ 2>/dev/null || true
  echo "  robots.txt, llms.txt, pricing.md, sitemap.xml, okf/ copied."
else
  echo "  cf-seo/ not found — skipping."
fi

# Step 2.5: Ensure D1 database exists (idempotent)
echo ""
echo "[2.5/3] Ensuring D1 database exists..."
cd "$PROJECT_DIR/workers"
DB_ID=$(grep -oE 'database_id = "[0-9a-f-]{36}"' wrangler.toml | cut -d'"' -f2 || true)
if [ -z "$DB_ID" ]; then
  if ! npx wrangler d1 list 2>/dev/null | grep -q "exameow-exams"; then
    npx wrangler d1 create exameow-exams
  fi
  if command -v jq >/dev/null 2>&1; then
    DB_ID=$(npx wrangler d1 list --json 2>/dev/null | sed -n '/^\[/,$p' | jq -r '.[] | select(.name == "exameow-exams") | .uuid' | head -1 || true)
  else
    DB_ID=$(npx wrangler d1 list 2>/dev/null | grep -A2 "exameow-exams" | grep -oE '[0-9a-f-]{36}' | head -1 || true)
  fi
  if [ -n "$DB_ID" ] && grep -q 'REPLACE_WITH_REAL_ID' wrangler.toml; then
    sed -i.bak "s/database_id = \"REPLACE_WITH_REAL_ID\"/database_id = \"$DB_ID\"/" wrangler.toml && rm -f wrangler.toml.bak
  fi
fi
if [ -z "$DB_ID" ]; then
  echo "  ERROR: could not determine D1 database_id for exameow-exams; set it manually in workers/wrangler.toml" >&2
  exit 1
fi
npx wrangler d1 migrations apply exameow-exams --remote

# MCP attempt drafts use a dedicated R2 bucket. Create it once before deployment.
echo "[2.6/3] Ensuring R2 draft-image bucket exists..."
if ! npx wrangler r2 bucket list | grep -q 'exameow-attempt-images'; then
  npx wrangler r2 bucket create exameow-attempt-images
fi

# Step 3: Deploy worker
echo ""
echo "[3/3] Deploying to Cloudflare..."
npx wrangler deploy

echo ""
echo "=== Deploy complete ==="
echo ""
echo "Your app is live at the URL shown above."
echo "To test the API: curl <YOUR_URL>/api/health"
