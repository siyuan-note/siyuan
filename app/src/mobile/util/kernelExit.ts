export const handleMobileKernelExit = (options: {
    inMobileApp: boolean,
    forceQuit: () => void,
    redirectBrowser: () => void,
}) => {
    if (options.inMobileApp) {
        options.forceQuit();
        return;
    }
    options.redirectBrowser();
};
