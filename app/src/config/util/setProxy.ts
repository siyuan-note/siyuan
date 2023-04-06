/// #if !BROWSER
import {getCurrentWindow} from "@electron/remote";
/// #endif

export const setProxy = () => {
    /// #if !BROWSER
    if ("" === window.siyuan.config.system.networkProxy.scheme) {
        console.log("network proxy [system]");
        return;
    }

    const session = getCurrentWindow().webContents.session;
    session.closeAllConnections().then(() => {
        const proxyURL = `${window.siyuan.config.system.networkProxy.scheme}://${window.siyuan.config.system.networkProxy.host}:${window.siyuan.config.system.networkProxy.port}`;
        session.setProxy({proxyRules: proxyURL}).then(
            () => console.log("network proxy [" + proxyURL + "]"),
        );
    });
    /// #endif
};
