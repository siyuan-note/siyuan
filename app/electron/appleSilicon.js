const getAppleSiliconDownloadURL = (version) => {
    const packageName = `jitang-notes-${version}-mac-arm64.dmg`;
    return `https://github.com/jitang-open/jitang-notes/releases/download/v${version}/${packageName}`;
};

const shouldDownloadAppleSilicon = (response) => response === 0;

const shouldShowAppleSiliconWarning = ({
    isDevelopment,
    isPackaged,
    platform,
    runningUnderARM64Translation,
    simulateRosetta,
}) => {
    if (!isPackaged && isDevelopment && simulateRosetta) {
        return true;
    }
    return isPackaged && platform === "darwin" && runningUnderARM64Translation;
};

module.exports = {
    getAppleSiliconDownloadURL,
    shouldDownloadAppleSilicon,
    shouldShowAppleSiliconWarning,
};
