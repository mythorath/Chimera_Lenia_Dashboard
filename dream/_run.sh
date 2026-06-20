#!/usr/bin/env bash
# Free disk from old dream recordings (keep newest 1) then start dream without recording.
set -eu
REC=/home/selis/Chimera_Lenia_Server/server/data/recordings
if [ -d "$REC" ]; then
  ls -t "$REC"/dream-*.mp4 2>/dev/null | tail -n +2 | xargs -r rm -f
  echo "recordings: $(du -sh "$REC" 2>/dev/null | cut -f1) remaining"
fi

cd /home/selis/Chimera_Lenia_Server/dream
echo "== stopping any existing dream =="
pkill -f 'dream.py' 2>/dev/null || true
sleep 1

echo "== starting dream renderer (HLS only, no recording) =="
setsid bash -c 'cd /home/selis/Chimera_Lenia_Server/dream && . .venv/bin/activate && python dream.py > dream.log 2>&1' < /dev/null > /dev/null 2>&1 &
sleep 16

echo "== dream log =="
tail -n 28 dream.log
echo "== hls =="
ls -la /home/selis/Chimera_Lenia_Server/server/data/hls 2>/dev/null | head
echo "== playlist =="
curl -s http://localhost:8080/cinema/stream.m3u8 | head
echo "== gpu =="
nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader 2>/dev/null
echo DREAM_RUN_DONE
