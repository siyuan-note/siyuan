import {escapeHtml} from "./escape";
import {Constants} from "../constants";
import {pathPosix} from "./pathName";

export const getWorkspaceName = () => {
    const dir = window.siyuan.config.system.workspaceDir;
    // 浏览器环境下内核不返回工作空间绝对路径，回退到“工作空间”（Workspace）。
    // 不能用 siyuanNote：setTitle 的标题模板本身已含 siyuanNote，会导致“思源笔记 - 思源笔记”重复。
    // 注意：该函数可能在 languages 加载前（如 setBodyHighlight）被调用，故用可选链，
    // 此时返回 undefined，由调用方（setBodyHighlight 的 if(!name) return）跳过处理
    // https://github.com/siyuan-note/siyuan/issues/17410
    return dir ? pathPosix().basename(dir.replace(/\\/g, "/")) : window.siyuan.languages?.workspace;
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
