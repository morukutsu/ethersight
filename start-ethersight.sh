#!/bin/bash
ROOT_DIR=`pwd`
trap 'kill %1' SIGINT
cd backend; node src/app.js --root-dir=$ROOT_DIR --input=$1 | tee $ROOT_DIR/1.log | sed -e 's/^/[server] /' & cd ../frontend; npm run dev | tee $ROOT_DIR/2.log | sed -e 's/^/[frontend] /'
