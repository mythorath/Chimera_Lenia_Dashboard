#!/usr/bin/env bash
set -eu
cd /home/selis/Chimera_Lenia_Server
mkdir -p logs

echo "== stopping any existing server/mock =="
pkill -f 'src/index.ts' 2>/dev/null || true
pkill -f 'src/mock-master.ts' 2>/dev/null || true
sleep 1

echo "== starting server (detached) =="
setsid bash -c 'cd /home/selis/Chimera_Lenia_Server && npm run start > logs/server.log 2>&1' < /dev/null &
sleep 4

echo "== starting mock master (detached) =="
setsid bash -c 'cd /home/selis/Chimera_Lenia_Server && npm run mock > logs/mock.log 2>&1' < /dev/null &
sleep 8

echo "== GET /api/health =="
curl -s http://localhost:8080/api/health; echo
echo "== GET /api/events/recent?limit=3 =="
curl -s "http://localhost:8080/api/events/recent?limit=3"; echo
echo "== GET /api/vitals (bytes) =="
curl -s http://localhost:8080/api/vitals | wc -c
echo "== GET / (SPA, first 160 chars) =="
curl -s http://localhost:8080/ | head -c 160; echo
echo "== listening sockets =="
ss -ltnp 2>/dev/null | grep -E ':8080|:8787' || true

echo "== server log tail =="
tail -n 16 logs/server.log
echo "== mock log tail =="
tail -n 8 logs/mock.log
echo "RUN_DONE"
