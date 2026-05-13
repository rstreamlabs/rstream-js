#!/bin/bash

set -euo pipefail

mkdir -p .generated/protobuf
npx pbjs -t static-module --es6 -w es6 -o .generated/protobuf/rstream.js ./protobuf/rstream.proto
npx pbts -o .generated/protobuf/rstream.d.ts .generated/protobuf/rstream.js
