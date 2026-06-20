#!/usr/bin/env bash
set -eu
cd /home/selis/Chimera_Lenia_Server
echo "== npm install =="
npm install --no-audit --no-fund
echo "== typecheck =="
npm run typecheck
echo "== build web =="
npm run build
mkdir -p logs server/data/hls server/data/recordings
echo "== restart server =="
pkill -f 'src/index.ts' 2>/dev/null || true
sleep 1
setsid bash -c 'cd /home/selis/Chimera_Lenia_Server && npm run start > logs/server.log 2>&1' < /dev/null > /dev/null 2>&1 &
sleep 4
echo "== health =="
curl -s http://localhost:8080/api/health; echo
echo "== /cinema dir served? =="
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/cinema/stream.m3u8; echo " (404 expected until dream runs)"
echo DEPLOY_DONE
