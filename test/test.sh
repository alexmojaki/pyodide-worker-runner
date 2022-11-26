#!/bin/bash
set -eux

webpack --mode production

python server.py &
TEST_SERVER_PORT=8003 TEST_SERVER_NO_COOP=1 python server.py &

sleep 3
curl -k http://localhost:8000
curl -k http://localhost:8003

pytest --tests-per-worker 2 test.py
