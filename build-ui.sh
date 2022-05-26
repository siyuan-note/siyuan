#!/bin/bash

echo 'Building UI'
cd app
npm install && npm run build
cd ..
