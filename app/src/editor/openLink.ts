import {getAssetExtension, isLocalPath} from "../util/pathName";
/// #if !BROWSER
import {shell} from "electron";
/// #endif
import {getSearch} from "../util/functions";
import {Constants} from "../constants";
import {processSiYuanUri} from "../util/uri";
/// #if !MOBILE
import {openAsset, openBy} from "./util";
/// #endif
import {showMessage} from "../dialog/message";
import {isInIOS, isInAndroid, isInHarmony} from "../protyle/util/compatibility";
import type {App} from "../index";
import {isBrowserRenderableImagePath} from "../util/imageURL";
import {
    DEFAULT_ASSET_OPEN,
    resolveAssetOpenAction,
    resolveExecutableAssetOpenAction,
} from "./assetOpen";
/// #if !MOBILE
import {openAssetNewWindow} from "../window/openNewWindow";
/// #endif

const isPreviewableAsset = (assetPath: string) => {
    const extension = getAssetExtension(assetPath).toLowerCase();
    return Constants.SIYUAN_ASSETS_EXTS.includes(extension) &&
        isBrowserRenderableImagePath(assetPath) &&
        (extension !== ".pdf" || assetPath.startsWith("assets/"));
};

const emitOpenAsset = (
    app: App,
    path: string,
    action: Config.TAssetOpenAction,
    event?: MouseEvent,
) => {
    let open = true;
    app.plugins.forEach((plugin) => {
        if (!plugin.eventBus.emit("open-asset", {path, action, event})) {
            open = false;
        }
    });
    return open;
};

export const openAssetByAction = (
    app: App,
    assetPath: string,
    page: number | string,
    action: Config.TAssetOpenAction,
) => {
    /// #if MOBILE
    openByMobile(assetPath);
    /// #else
    const resolvedAction = resolveExecutableAssetOpenAction(action, {
        previewable: isPreviewableAsset(assetPath),
        noSplitScreen: window.siyuan.config.fileTree.noSplitScreenWhenOpenTab,
    });
    if (resolvedAction === "current") {
        openAsset(app, assetPath, page);
    } else if (resolvedAction === "right") {
        openAsset(app, assetPath, page, "right");
    } else if (resolvedAction === "new-window") {
        /// #if !BROWSER
        openAssetNewWindow(assetPath, {}, page);
        /// #else
        openByMobile(assetPath);
        /// #endif
    } else if (resolvedAction === "folder") {
        /// #if !BROWSER
        openBy(assetPath, "folder");
        /// #else
        openByMobile(assetPath);
        /// #endif
    } else {
        /// #if !BROWSER
        openBy(assetPath, "app");
        /// #else
        openByMobile(assetPath);
        /// #endif
    }
    /// #endif
};

export const openLink = (app: App, aLink: string, event?: MouseEvent, ctrlIsPressed = false) => {
    let linkAddress = Lute.UnEscapeHTMLStr(aLink);
    const originalLinkAddress = linkAddress;
    const isAsset = linkAddress.startsWith("assets/");
    let pdfParams;
    if (isLocalPath(linkAddress) && !linkAddress.startsWith("file://") && linkAddress.indexOf(".pdf") > -1) {
        const pdfAddress = linkAddress.split("/");
        if (pdfAddress.length === 3 && pdfAddress[0] === "assets" && pdfAddress[1].endsWith(".pdf") && /\d{14}-\w{7}/.test(pdfAddress[2])) {
            linkAddress = `assets/${pdfAddress[1]}`;
            pdfParams = pdfAddress[2];
        } else {
            pdfParams = parseInt(getSearch("page", linkAddress));
            linkAddress = linkAddress.split("?page")[0];
        }
    }
    let assetOpenConfig = isAsset ? window.siyuan.config.editor.assetOpen : DEFAULT_ASSET_OPEN;
    /// #if BROWSER
    assetOpenConfig = DEFAULT_ASSET_OPEN;
    /// #endif
    const configuredAction = resolveAssetOpenAction(
        assetOpenConfig,
        {
            altKey: event?.altKey,
            shiftKey: event?.shiftKey,
            ctrlKey: ctrlIsPressed,
        },
    );
    let action = resolveExecutableAssetOpenAction(configuredAction, {
        previewable: isPreviewableAsset(linkAddress),
        noSplitScreen: window.siyuan.config.fileTree.noSplitScreenWhenOpenTab,
    });
    /// #if BROWSER
    if (action === "folder" || action === "new-window") {
        action = "app";
    }
    /// #endif
    /// #if MOBILE
    action = "app";
    /// #endif
    if (isAsset && !emitOpenAsset(app, originalLinkAddress, action, event)) {
        return;
    }
    if (processSiYuanUri(app, linkAddress)) {
        return;
    }
    /// #if MOBILE
    openByMobile(linkAddress);
    /// #else
    if (isLocalPath(linkAddress)) {
        openAssetByAction(app, linkAddress, pdfParams, action);
    } else if (linkAddress) {
        if (0 > linkAddress.indexOf(":")) {
            // 使用 : 判断，不使用 :// 判断 Open external application protocol invalid https://github.com/siyuan-note/siyuan/issues/10075
            // Support click to open hyperlinks like `www.foo.com` https://github.com/siyuan-note/siyuan/issues/9986
            linkAddress = `https://${linkAddress}`;
        }
        /// #if !BROWSER
        shell.openExternal(linkAddress).catch((e) => {
            showMessage(e);
        });
        /// #else
        openByMobile(linkAddress);
        /// #endif
    }
    /// #endif
};

export const openByMobile = (uri: string) => {
    if (!uri) {
        return;
    }
    if (processSiYuanUri(window.siyuan.ws.app, uri)) {
        return;
    }
    if (isInIOS()) {
        if (uri.startsWith("assets/")) {
            // iOS 16.7 之前的版本，uri 需要 encodeURIComponent
            // 保留 query 参数（如 ?box=<id>），只编码 path 部分
            const pathAndQuery = uri.replace("assets/", "");
            const queryIdx = pathAndQuery.indexOf("?");
            let encodedPath = pathAndQuery;
            let query = "";
            if (queryIdx >= 0) {
                encodedPath = pathAndQuery.substring(0, queryIdx);
                query = pathAndQuery.substring(queryIdx);
            }
            window.webkit.messageHandlers.openLink.postMessage(location.origin + "/assets/" + encodeURIComponent(encodedPath) + query);
        } else if (uri.startsWith("/")) {
            // 导出 zip 返回的是已经 encode 过的，因此不能再 encode
            window.webkit.messageHandlers.openLink.postMessage(location.origin + uri);
        } else {
            try {
                new URL(uri);
                window.webkit.messageHandlers.openLink.postMessage(uri);
            } catch (e) {
                window.webkit.messageHandlers.openLink.postMessage("https://" + uri);
            }
        }
    } else if (isInAndroid()) {
        window.JSAndroid.openExternal(uri);
    } else if (isInHarmony()) {
        window.JSHarmony.openExternal(uri);
    } else {
        window.open(uri);
    }
};
