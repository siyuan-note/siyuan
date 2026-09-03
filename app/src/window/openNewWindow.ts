import {layoutToJSON} from "../layout/util";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {Constants} from "../constants";
import {Tab} from "../layout/Tab";
import {fetchSyncPost} from "../util/fetch";
import {showMessage} from "../dialog/message";
import {getAssetExtension, getDisplayName} from "../util/pathName";
import {getSearch} from "../util/functions";
import {isBrowserRenderableImagePath} from "../util/imageURL";
import {appendRemoteQuery} from "../util/hostCapabilities";

interface windowOptions {
    position?: {
        x: number,
        y: number,
    },
    width?: number,
    height?: number,
    alwaysOnTop?: boolean,
}

const getWindowURL = (layout: unknown) => {
    const url = new URL("/stage/build/app/window.html", window.location.origin);
    url.searchParams.set("v", Constants.SIYUAN_VERSION);
    url.searchParams.set("json", JSON.stringify(layout));
    return appendRemoteQuery(url).href;
};

export const openNewWindow = (tab: Tab, options: windowOptions = {}) => {
    const json = {};
    layoutToJSON(tab, json);
    /// #if !BROWSER
    ipcRenderer.send(Constants.SIYUAN_OPEN_WINDOW, {
        position: options.position,
        width: options.width,
        height: options.height,
        alwaysOnTop: !!options.alwaysOnTop,
        url: getWindowURL([json]),
    });
    /// #endif
    tab.parent.removeTab(tab.id);
};

export const openNewWindowById = async (id: string | string[], options: windowOptions = {}) => {
    let ids = id;
    if (typeof ids === "string") {
        ids = [ids];
    }
    const json = [];
    for (let i = 0; i < ids.length; i++) {
        const response = await fetchSyncPost("/api/block/getBlockInfo", {id: ids[i]});
        if (response.code === 3) {
            showMessage(response.msg);
            return;
        }
        json.push({
            title: response.data.rootTitle,
            docIcon: response.data.rootIcon,
            pin: false,
            active: true,
            instance: "Tab",
            action: "Tab",
            children: {
                notebookId: response.data.box,
                blockId: ids[i],
                rootId: response.data.rootID,
                mode: "wysiwyg",
                instance: "Editor",
                action: response.data.rootID === ids[i] ? Constants.CB_GET_SCROLL : Constants.CB_GET_ALL
            }
        });
    }
    /// #if !BROWSER
    ipcRenderer.send(Constants.SIYUAN_OPEN_WINDOW, {
        position: options.position,
        width: options.width,
        height: options.height,
        alwaysOnTop: !!options.alwaysOnTop,
        url: getWindowURL(json),
    });
    /// #endif
};

export const openAssetNewWindow = (
    assetPath: string,
    options: windowOptions = {},
    page?: number | string,
) => {
    /// #if !BROWSER
    const suffix = getAssetExtension(assetPath).toLowerCase();
    if (Constants.SIYUAN_ASSETS_EXTS.includes(suffix) &&
        isBrowserRenderableImagePath(assetPath)) {
        let docIcon = "iconPDF";
        if (Constants.SIYUAN_ASSETS_IMAGE.includes(suffix)) {
            docIcon = "iconImage";
        } else if (Constants.SIYUAN_ASSETS_AUDIO.includes(suffix)) {
            docIcon = "iconRecord";
        } else if (Constants.SIYUAN_ASSETS_VIDEO.includes(suffix)) {
            docIcon = "iconVideo";
        }
        const json: any = [{
            title: getDisplayName(assetPath),
            docIcon,
            pin: false,
            active: true,
            instance: "Tab",
            action: "Tab",
            children: {
                path: assetPath,
                page: page ?? parseInt(getSearch("page", assetPath)),
                instance: "Asset",
            }
        }];
        ipcRenderer.send(Constants.SIYUAN_OPEN_WINDOW, {
            position: options.position,
            width: options.width,
            height: options.height,
            alwaysOnTop: !!options.alwaysOnTop,
            url: getWindowURL(json),
        });
    }
    /// #endif
};
