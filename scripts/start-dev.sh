#!/bin/bash
# 
# Description:
#   Start running siyuan background development environment...   
#   If there is an environment running already, it will take you into
#   the shell of the container.
#
# Preparation:
#   Archlinux:
#       sudo pacman -S podman catatonit buildah
#   Fedora & RHEL:
#       sudo dnf install podman catatonit buildah
#   Ubuntu & Debian:
#       sudo apt install podman catatonit buildah

set -eo pipefail

BASEDIR=$(cd `dirname $BASH_SOURCE`;pwd)
NAME="siyuan-go-dev"
PODNAME="siyuan"
USERID=0
REBUILD=0
FRONTEND=0
BACKEND=0
WORKSPACE=$(cd `dirname $BASEDIR`;echo `pwd`/"Documents/SiYuan")

function InitlizePod () {
    echo "Start to initilize pod..."
    found=$(podman pod ps | grep ${PODNAME} || :)
    if [[ -n "${found}" ]];then
        echo "Found pod ${PODNAME}, starting..."
        podman pod start ${PODNAME} > /dev/null || (podman pod rm -f ${PODNAME} && podman pod start ${PODNAME})
    else
        echo "Create pod..."
        podman pod create --name ${PODNAME} -p 6806:6807
    fi
}

function BuildFrontImage () {
    if [[ "$(podman images ${NAME} 2>&1 >/dev/null;echo $?)" != "0" || "${REBUILD}" == "1" ]];then
        echo "Start build ${NAME} image..."
        buildah ps -a | grep -q ${NAME} && buildah rm ${NAME} || :
        container=$(buildah from --name ${NAME} docker.io/library/node:16-bullseye)
        buildah run ${container} -- sh -c "sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|' /etc/apt/sources.list &&
            sed -i 's|security.debian.org/debian-security|mirrors.ustc.edu.cn/debian-security|g' /etc/apt/sources.list &&
            apt-get update -y &&
            apt-get upgrade -y &&
            apt install -y build-essential make"
        buildah run ${container} -- npm --registry=https://registry.npm.taobao.org install --location=global pnpm
        buildah config \
            --workingdir /go/src/github.com/siyuan-note/siyuan/app \
            --env ELECTRON_MIRROR=https://cnpmjs.org/mirrors/electron/ \
            --user ${USERID} ${NAME}
        buildah run \
            -v "$(pwd):/go/src/github.com/siyuan-note/siyuan" \
            ${container} -- sh -c "pnpm config set registry https://registry.npm.taobao.org/ &&
                pnpm install"
        buildah config --cmd "pnpm run dev:desktop" ${container}
        buildah commit ${container} ${NAME}
        buildah rm ${container}
    fi
}

function BuildGoImage () {
    if [[ "$(podman images ${NAME} 2>&1 >/dev/null;echo $?)" != "0" || "${REBUILD}" == "1" ]];then
        echo "Start build ${NAME} image..."
        buildah ps -a | grep -q ${NAME} && buildah rm ${NAME} || :
        container=$(buildah from --name ${NAME} docker.io/library/golang:1-bullseye)
        buildah run ${container} -- sh -c "sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|' /etc/apt/sources.list &&
            sed -i 's|security.debian.org/debian-security|mirrors.ustc.edu.cn/debian-security|g' /etc/apt/sources.list &&
            apt-get update -y &&
            apt-get upgrade -y &&
            apt install -y build-essential make"
        buildah run ${container} -- sh -c "mkdir -p /home/siyuan/Documents/SiYuan;chmod 777 -R /home/siyuan"
        buildah config \
            --workingdir /go/src/github.com/siyuan-note/siyuan \
            --env GO111MODULE=on \
            --env GOPROXY=https://goproxy.io \
            --env CGO_ENABLED=1 \
            --env GOCACHE=/go/cache/go-build \
            --env GOOS=linux \
            --env GOARCH=amd64 \
            --env WD=/go/src/github.com/siyuan-note/siyuan/app \
            --env MODE=dev \
            --env PORT=6807 \
            --env TZ=Asia/Shanghai \
            --env WORKSPACE=/home/siyuan/Documents/SiYuan \
            --user ${USERID} ${container}
        buildah run \
            -v "$(pwd):/go/src/github.com/siyuan-note/siyuan" "${container}" \
            -- go install github.com/codegangsta/gin@latest
        buildah config --cmd scripts/kernel-live-reload.sh ${container}
        buildah commit ${container} ${NAME}
        buildah rm ${container}
    fi
}

function BuildImage () {
    if [[ ${FRONTEND} == 1 ]];then
        NAME="siyuan-front-dev"
        BuildFrontImage
    else
        NAME="siyuan-go-dev"
        BuildGoImage
    fi
}

function StartDev () {
    if [[ -n "$(podman ps | grep ${NAME} || :)" ]];then
        podman exec -u ${USERID} -ti ${NAME} bash
    else
        podman ps -a | grep -q ${NAME} && podman rm ${NAME} || :
        [ ! -d ${WORKSPACE} ] && mkdir -p ${WORKSPACE} && chown -R ${USERID} ${WORKSPACE}
        podman run --rm --pod ${PODNAME} --name ${NAME} -u ${USERID} -ti -v "$(pwd):/go/src/github.com/siyuan-note/siyuan" -v "${WORKSPACE}:/home/siyuan/Documents/SiYuan" ${NAME}
    fi
}

for i in "$@"; do
    case $i in
        -r|--rebuild)
            REBUILD=1
            shift
            ;;
        -u=*|--uid=*)
            USERID="${i#*=}"
            shift
            ;;
        -u|--uid)
            shift
            USERID=$1
            shift
            ;;
        -ws=*|--workspace=*)
            WORKSPACE="${i#*=}"
            shift
            ;;
        -ws|--workspace)
            shift
            WORKSPACE=$1
            shift
            ;;
        -f|--frontend)
            FRONTEND=1
            shift
            ;;
        -b|--backend)
            BACKEND=1
            shift
            ;;
        -h|--help)
            echo ""
            echo "Usage:"
            echo "    $(basename $BASH_SOURCE) [-ws|--workspace <WORKSPACE>] [-u|--uid <UID>]  [-r|--rebuild] [-f|--frontend] [-b|--backend]"
            echo ""
            echo "Arguments:"
            echo ""
            echo "    -h, --help                                   Print help information"
            echo "    -u=<UID>, --uid=<UID>                        Set the user id (default: 0)"
            echo "    -ws=<WORKSPACE>, --workspace=<WORKSPACE>     Set workspace directory for SiYuan kernel (default: Documents/SiYuan)"
            echo "    -r, --rebuild                                Force rebuild image (default: false)"
            echo "    -f, --frontend                               Start frontend devlop (default: false)"
            echo "    -b, --backend                                Start backend devlop (default: true)"
            echo ""
            echo "Examples:"
            echo ""
            echo '    sudo scripts/start-dev.sh -u $(id -u) -f                    # Start frontend development'
            echo '    sudo scripts/start-dev.sh -u $(id -u) -f                    # Run the command again to attach container shell'
            echo '    sudo scripts/start-dev.sh -u $(id -u) -b                    # Start backend development with workspace mapping with default'
            echo '    sudo scripts/start-dev.sh -u $(id -u) -b -ws /tmp/siyuan    # Start backend development with workspace mapping with /tmp/siyuan'
            echo '    sudo scripts/start-dev.sh -u $(id -u) -f -r                 # Force rebuild frontend image'
            echo '    sudo scripts/start-dev.sh -u $(id -u) -b -r                 # Force rebuild backend image'
            echo '    sudo scripts/start-dev.sh -u $(id -u) -b -r                 # Force rebuild backend image'
            echo "    sudo scripts/start-dev.sh -u 0 -f                           # Attach frontend container as root"
            echo "    sudo scripts/start-dev.sh -u 0 -b                           # Attach backend container as root"
            exit 2
            ;;
        -*|--*)
            echo "Unknown option $i"
            exit 1
            ;;
    esac
done

if [[ "${UID}" != "0" ]];then
    echo "Must run as root."
    exit 1
fi

BuildImage && \
    InitlizePod && \
    StartDev
