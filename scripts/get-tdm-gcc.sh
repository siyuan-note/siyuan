#!/bin/sh
# This script is to set up tdm-gcc environment for windows ci.
# BE CAREFUL! THIS SCRIPT WILL DESTROY THE ROOT OF TDM-DCC AT FIRST.
# Usage:
# bash /path/to/the/script /path/to/tdm-gcc/sysroot <URL>

BASEDIR=$(rm -rf $1 && mkdir $1 && cd $1 && pwd)
TDM_URL=$2

function DecompressTDM () {
    echo "Downloading From ${TDM_URL}..."
    wget ${TDM_URL} -O "${BASEDIR}/tdm.exe" > /dev/null
    echo "Decompress the archive..."
    7z e -y "${BASEDIR}/tdm.exe" -o"${BASEDIR}" > /dev/null
    for tarbar in "${BASEDIR}/"*.tar.xz
    do
        # We can't use tar -Jxvf here, it will cause pipeline hanging.
        xz -d "${tarbar}" -c > "${tarbar%.xz}"
        tar -xf "${tarbar%.xz}" -C ${BASEDIR}
    done
}


function CreateFeaturesHeader() {
    echo "Creating features.h..."
    cat > "${BASEDIR}/include/features.h" <<EOF
#ifndef __MINGW_FEATURES__
#pragma GCC system_header

#define __MINGW_FEATURES__    (__MINGW_FEATURES_BEGIN__)        \\
 __MINGW_FEATURE_IGNORE__     (__MINGW_ANSI_STDIO__)            \\
 __MINGW_FEATURE_IGNORE__     (__MINGW_LC_MESSAGES__)           \\
 __MINGW_FEATURE_IGNORE__     (__MINGW_LC_ENVVARS__)            \\
 __MINGW_FEATURES_END__

#endif
EOF
}

DecompressTDM
CreateFeaturesHeader
