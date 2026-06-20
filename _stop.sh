#!/usr/bin/env bash
set -eu
cd /home/selis/Chimera_Lenia_Server

echo "== stopping Chimera Lenia dashboard =="
pkill -f 'src/index.ts' 2>/dev/null || true
pkill -f 'src/mock-master.ts' 2>/dev/null || true
sleep 1

if ss -ltnp 2>/dev/null | grep -qE ':8080|:8787'; then
  echo "WARN: ports still listening:"
  ss -ltnp 2>/dev/null | grep -E ':8080|:8787' || true
  exit 1
fi

echo "== dashboard stopped (8080/8787 closed) =="
pgrep -af 'index.ts|mock-master' || echo "no chimera node procs"
