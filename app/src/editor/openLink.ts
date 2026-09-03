import {getAssetExtension, isLocalPath} from "../util/pathName";
/// #if !BROWSER
import {shell} from "electron";
/// #endif
import {getSearch} from "../util/functions";
import {Constants} from "../constants";
import {processSiYuanUri} from "../util/uri";
/// #if !MOBILE
import {openAsset, openAssetInBackground, openBy} from "./util";
/// #endif
import {showMessage} from "../dialog/message";
import {isInIOS, isInAndroid, isInHarmony} from "../protyle/util/compatibility";
import type {App} from "../index";
import {isBrowserRenderableImagePath} from "../util/imageURL";
import {
    DEFAULT_ASSET_OPEN,
    resolveAvailableAssetOpenAction,
    resolveAssetOpenAction,
    resolveExecutableAssetOpenAction,
} from "./assetOpen";
import {emitOpenAsset, emitOpenLink, resolveOpenLinkEvent} from "./openLinkEvent";
import {resolvePdfAssetLink} from "./pdfAssetLink";
import {canOpenExternalURL, getHostCapabilities} from "../util/hostCapabilities";
/// #if !MOBILE
import {openAssetNewWindow} from "../window/openNewWindow";
/// #endif
/// #if MOBILE
import {openMobilePDF} from "../mobile/pdf";
/// #endif

const isPreviewableAsset = (assetPath: string) => {
    const extension = getAssetExtension(assetPath).toLowerCase();
    return Constants.SIYUAN_ASSETS_EXTS.includes(extension) &&
        isBrowserRenderableImagePath(assetPath) &&
        (extension !== ".pdf" || assetPath.startsWith("assets/"));
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
    const resolvedAction = resolveAvailableAssetOpenAction(resolveExecutableAssetOpenAction(action, {
        previewable: isPreviewableAsset(assetPath),
        noSplitScreen: window.siyuan.config.fileTree.noSplitScreenWhenOpenTab,
    }), getHostCapabilities().localFileSystem);
    if (resolvedAction === "current") {
        openAsset(app, assetPath, page);
    } else if (resolvedAction === "right") {
        openAsset(app, assetPath, page, "right");
    } else if (resolvedAction === "bottom") {
        openAsset(app, assetPath, page, "bottom");
    } else if (resolvedAction === "background") {
        openAssetInBackground(app, assetPath, page);
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
    if (isLocalPath(linkAddress) && !linkAddress.startsWith("file://")) {
        if (linkAddress.startsWith("assets/")) {
            const resolvedPdfLink = resolvePdfAssetLink(linkAddress);
            linkAddress = resolvedPdfLink.linkAddress;
            pdfParams = resolvedPdfLink.pdfParams;
        } else if (linkAddress.toLowerCase().indexOf(".pdf") > -1) {
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
    let action = resolveAvailableAssetOpenAction(resolveExecutableAssetOpenAction(configuredAction, {
        previewable: isPreviewableAsset(linkAddress),
        noSplitScreen: window.siyuan.config.fileTree.noSplitScreenWhenOpenTab,
    }), getHostCapabilities().localFileSystem);
    /// #if BROWSER
    if (action === "folder" || action === "new-window") {
        action = "app";
    }
    /// #endif
    /// #if MOBILE
    const isInternalMobilePdf = linkAddress.startsWith("assets/") &&
        getAssetExtension(linkAddress).toLowerCase() === ".pdf";
    action = isInternalMobilePdf ? "current" : "app";
    /// #endif
    const openLinkEvent = resolveOpenLinkEvent({
        href: linkAddress,
        originalHref: aLink,
        isAsset,
        isLocal: isLocalPath(linkAddress),
        event,
    });
    if (isAsset) {
        if (!emitOpenAsset(app, originalLinkAddress, action, event)) {
            return;
        }
    } else if (openLinkEvent) {
        linkAddress = openLinkEvent.href;
        if (!emitOpenLink(app, openLinkEvent)) {
            return;
        }
    }
    if (processSiYuanUri(app, linkAddress)) {
        return;
    }
    /// #if MOBILE
    if (isInternalMobilePdf) {
        openMobilePDF(linkAddress, pdfParams);
    } else {
        openByMobile(linkAddress);
    }
    /// #else
    if (isLocalPath(linkAddress)) {
        openAssetByAction(app, linkAddress, pdfParams, action);
    } else if (linkAddress) {
        /// #if !BROWSER
        if (!canOpenExternalURL(linkAddress)) {
            return;
        }
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
    if (!canOpenExternalURL(uri)) {
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
