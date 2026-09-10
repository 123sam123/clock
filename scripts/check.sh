#!/bin/sh
# The repo's quality gate: verify the engine module loads as ESM, then run the tests.
set -eu
cd "$(dirname "$0")/.."

# node --check would parse a bare .js file as CommonJS and reject `export`,
# so verify syntax by actually importing the module instead.
node --input-type=module -e "await import('./src/timer.js')"

node --test test/
