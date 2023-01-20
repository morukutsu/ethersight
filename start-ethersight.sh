#!/bin/bash
ROOT_DIR=`pwd`
trap 'kill %1' SIGINT
cd backend; node src/app.js --root-dir=$ROOT_DIR --input=$1 | tee $ROOT_DIR/1.log | sed -e 's/^/[server] /' & cd ../frontend; npm run dev | tee $ROOT_DIR/2.log | sed -e 's/^/[frontend] /'

#~$ trap 'kill %1; kill %2' SIGINT
#~$ command1 | tee 1.log | sed -e 's/^/[Command1] /' & command2 | tee 2.log | sed -e 's/^/[Command2] /' & command3 | tee 3.log | sed -e 's/^/[Command3] /'