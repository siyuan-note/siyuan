import {layoutToJSON} from "../layout/util";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {Constants} from "../constants";
import {Tab} from "../layout/Tab";
import {fetchPost} from "../util/fetch";

export const openNewWindow = (tab: Tab) => {
    const json = {};
    layoutToJSON(tab, json);
    /// #if !BROWSER
    ipcRenderer.send(Constants.SIYUAN_OPENWINDOW, `${window.location.protocol}//${window.location.host}/stage/build/app/window.html?v=${Constants.SIYUAN_VERSION}&json=${JSON.stringify(json)}`);
    /// #endif
    tab.parent.removeTab(tab.id);
};

export const openNewWindowById = (id: string) => {
    fetchPost("api/block/getBlockInfo", {id}, (response) => {
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
                json.children.scrollAttr = JSON.parse(attrResponse.data.scroll || "{}");
                /// #if !BROWSER
                ipcRenderer.send(Constants.SIYUAN_OPENWINDOW, `${window.location.protocol}//${window.location.host}/stage/build/app/window.html?v=${Constants.SIYUAN_VERSION}&json=${JSON.stringify(json)}`);
                /// #endif
            });
        } else {
            json.children.action = Constants.CB_GET_ALL;
            json.children.scrollAttr = {
                startId: id,
                endId: id,
                scrollTop: 0,
                focusId: id,
                focusStart: 0,
                focusEnd: 0
            };
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_OPENWINDOW, `${window.location.protocol}//${window.location.host}/stage/build/app/window.html?v=${Constants.SIYUAN_VERSION}&json=${JSON.stringify(json)}`);
            /// #endif
        }
    });

};
