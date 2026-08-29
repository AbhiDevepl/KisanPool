#!/usr/bin/env bash
# Integration suite. Requires a running server (npm run dev:server) and a seeded
# database (npm run seed). Exercises the MVP definition of done end to end.
set -e
cd "$(dirname "$0")/.."

# The suites assert against known seed data — vehicle capacity, rating counts — so
# start from a clean database every time.
echo "########## 0. reseeding ##########"
npm run seed --silent

echo "########## 1. core flow: auth, KYC gate, matching, payment, booking ##########"
python3 tests/01_core_flow.py

echo
echo "########## 2. concurrency, refunds, payouts, ratings ##########"
python3 tests/02_concurrency_payouts.py

echo
echo "########## 3. realtime: sockets, rooms, live location, chat ##########"
node tests/03_realtime.mjs

echo
echo "########## 4. Servo AI: tool contract and safety rules ##########"
python3 tests/04_servo_ai.py

echo
echo "All suites passed."
