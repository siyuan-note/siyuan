import {layoutToJSON} from "../layout/util";
/// #if !BROWSER
import {ipcRenderer} from "electron";
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {Constants} from "../constants";
import {Tab} from "../layout/Tab";
import {fetchPost} from "../util/fetch";
import {showMessage} from "../dialog/message";

interface windowOptions {
    position?: {
        x: number,
        y: number,
    },
    width?: number,
    height?: number
}

export const openNewWindow = (tab: Tab, options: windowOptions = {}) => {
    const json = {};
    layoutToJSON(tab, json);
    /// #if !BROWSER
    ipcRenderer.send(Constants.SIYUAN_OPEN_WINDOW, {
        position: options.position,
        width: options.width,
        height: options.height,
        id: getCurrentWindow().id,
        url: `${window.location.protocol}//${window.location.host}/stage/build/app/window.html?v=${Constants.SIYUAN_VERSION}&json=${JSON.stringify(json)}`
    });
    /// #endif
    tab.parent.removeTab(tab.id);
};

export const openNewWindowById = (id: string, options: windowOptions = {}) => {
    fetchPost("/api/block/getBlockInfo", {id}, (response) => {
        if (response.code === 3) {
            showMessage(response.msg);
            return;
        }
        const json: any = {
            title: response.data.rootTitle,
            docIcon: response.data.rootIcon,
            pin: false,
            active: true,
            instance: "Tab",
            action: "Tab",
            children: {
                notebookId: response.data.box,
                blockId: id,
                rootId: response.data.rootID,
                mode: "wysiwyg",
                instance: "Editor",
            }
        };
        if (response.data.rootID === id) {
            fetchPost("/api/attr/getBlockAttrs", {id}, (attrResponse) => {
                if (attrResponse.data.scroll) {
                    json.children.scrollAttr = JSON.parse(attrResponse.data.scroll);
                    // 历史数据兼容
                    json.children.scrollAttr.rootId = response.data.rootID;
                }
                /// #if !BROWSER
                ipcRenderer.send(Constants.SIYUAN_OPEN_WINDOW, {
                    position: options.position,
                    width: options.width,
                    height: options.height,
                    id: getCurrentWindow().id,
                    url: `${window.location.protocol}//${window.location.host}/stage/build/app/window.html?v=${Constants.SIYUAN_VERSION}&json=${JSON.stringify(json)}`
                });
                /// #endif
            });
        } else {
            json.children.action = Constants.CB_GET_ALL;
            json.children.scrollAttr = {
                zoomInId: id,
            };
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_OPEN_WINDOW, {
                position: options.position,
                width: options.width,
                height: options.height,
                id: getCurrentWindow().id,
                url: `${window.location.protocol}//${window.location.host}/stage/build/app/window.html?v=${Constants.SIYUAN_VERSION}&json=${JSON.stringify(json)}`
            });
            /// #endif
        }
    });

};
