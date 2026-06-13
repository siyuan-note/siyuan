import {escapeHtml} from "./escape";
import {Constants} from "../constants";
import {pathPosix} from "./pathName";

export const getWorkspaceName = () => {
    return pathPosix().basename(window.siyuan.config.system.workspaceDir.replace(/\\/g, "/"));
};

export const setTitle = (title: string, showVersionTitle = false) => {
    const dragElement = document.getElementById("drag");
    const workspaceName = getWorkspaceName();
    if (showVersionTitle) {
        const versionTitle = `${workspaceName} - ${window.siyuan.languages.siyuanNote} v${Constants.SIYUAN_VERSION}`;
        document.title = versionTitle;
        if (!window.siyuan.config.appearance.hideToolbar && dragElement) {
            dragElement.textContent = versionTitle;
            dragElement.setAttribute("title", versionTitle);
        }
    } else {
        title = title.trim() || window.siyuan.languages["_kernel"][16];
        document.title = `${title} - ${workspaceName} - ${window.siyuan.languages.siyuanNote} v${Constants.SIYUAN_VERSION}`;
        if (!window.siyuan.config.appearance.hideToolbar && dragElement) {
            dragElement.setAttribute("title", title);
            dragElement.innerHTML = escapeHtml(title);
        }
    }
};
