#!/bin/bash
set -eux

webpack --mode production

python server.py &
TEST_SERVER_PORT=8001 TEST_SERVER_HTTPS=1 python server.py &
TEST_SERVER_PORT=8002 TEST_SERVER_HTTPS=1 TEST_SERVER_NO_COOP=1 python server.py &

sleep 3
curl -k http://localhost:8000
curl -k https://localhost:8001
curl -k https://localhost:8002

pytest --tests-per-worker 6 test.py
