#!/bin/sh

cd kernel
gin --port 6807 \
    --appPort 6806 \
    --buildArgs '--tags fts5 -ldflags "-s -w"' \
    -b ../app/kernel/kernel \
    run 
