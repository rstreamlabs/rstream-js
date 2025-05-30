#!/bin/bash

mkdir -p .generated/protobuf
npx pbjs -t static-module --es6 -w es6 -o .generated/protobuf/webtty.js ./protobuf/webtty.proto
npx pbts -o .generated/protobuf/webtty.d.ts .generated/protobuf/webtty.js
