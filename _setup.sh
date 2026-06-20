#!/usr/bin/env bash
set -euo pipefail
cd /home/selis/Chimera_Lenia_Server

echo "== chown project to selis =="
sudo -n chown -R selis:selis /home/selis/Chimera_Lenia_Server

echo "== node/npm =="
node -v; npm -v

echo "== npm install (root + workspaces) =="
npm install --no-audit --no-fund

echo "== typecheck =="
npm run typecheck

echo "== build web SPA =="
npm run build

echo "== web/dist contents =="
ls -la web/dist

echo "SETUP_DONE"
