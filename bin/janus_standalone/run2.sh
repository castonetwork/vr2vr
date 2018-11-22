#!/bin/bash
SCRIPTPATH=$(cd "$(dirname "$0")" && pwd)
export DYLD_LIBRARY_PATH=$DYLD_LIBRARY_PATH:$SCRIPTPATH/lib/janus/standalone
cd $SCRIPTPATH
echo $SCRIPTPATH
$SCRIPTPATH/bin/janus -F $SCRIPTPATH/etc/janus2/ -c $SCRIPTPATH/share/janus/certs/mycert.pem -k $SCRIPTPATH/share/janus/certs/mycert.key -P $SCRIPTPATH/lib/janus/plugins $1
