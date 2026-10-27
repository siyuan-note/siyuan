import {Constants} from "../../constants";
import {addScriptSync} from "./addScript";

const needsCompatibility = () => typeof structuredClone !== "function" ||
    typeof (Object as ObjectConstructor & {groupBy?: unknown}).groupBy !== "function" ||
    typeof (URL as typeof URL & {parse?: unknown}).parse !== "function" ||
    typeof AbortSignal.any !== "function" ||
    typeof (Promise as PromiseConstructor & {withResolvers?: unknown}).withResolvers !== "function";

export const ensureBrowserCompatibility = async (cdn = Constants.PROTYLE_CDN) => {
    if (!needsCompatibility()) return;
    await addScriptSync(`${cdn}/js/webview-compat.js?v=1`, "protyleBrowserCompatScript", {reloadOnFailure: false});
    if (needsCompatibility()) {
        throw new Error(window.siyuan.languages.loadingError);
    }
};
