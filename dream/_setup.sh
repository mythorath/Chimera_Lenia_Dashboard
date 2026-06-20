#!/usr/bin/env bash
set -euo pipefail
cd /home/selis/Chimera_Lenia_Server/dream

echo "== creating venv =="
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip wheel

echo "== installing torch (CUDA 12.4 wheels) =="
pip install torch --index-url https://download.pytorch.org/whl/cu124

echo "== installing numpy + websockets =="
pip install numpy websockets

echo "== verify GPU =="
python - <<'PY'
import torch
print("torch", torch.__version__, "cuda_available", torch.cuda.is_available())
print("device", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NONE")
PY
echo DREAM_SETUP_DONE
