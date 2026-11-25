import {escapeHtmlTextAndAttr} from "../../util/escape";
import {fetchPost} from "../../util/fetch";
import {pathPosix} from "../../util/pathName";
import {canManageMobileWorkspaces} from "./workspaceManager";

export const mountMobileWorkspaceMenu = (menuElement: HTMLElement, onRender: () => void) => {
    const list = menuElement.querySelector("#mobile-menu-group-workspaces");
    if (!list || !canManageMobileWorkspaces()) {
        return;
    }
    let renderedHTML: string;
    const render = (paths: string[]) => {
        const currentPath = window.siyuan.config.system.workspaceDir;
        const html = [...new Set([currentPath, ...paths])].map(path => {
            const current = path === currentPath;
            return `<button type="button" class="b3-menu__item${current ? " b3-menu__item--selected" : ""}" ${current ? 'disabled aria-current="true"' : `data-workspace-path="${escapeHtmlTextAndAttr(path)}"`}>
    <svg class="b3-menu__icon" aria-hidden="true"><use xlink:href="#iconFolder"></use></svg>
    <span class="b3-menu__label">${escapeHtmlTextAndAttr(pathPosix().basename(path))}</span>
    <svg class="b3-menu__icon b3-menu__icon--small" aria-hidden="true"><use xlink:href="#${current ? "iconSelect" : "iconRight"}"></use></svg>
</button>`;
        }).join("");
        if (html !== renderedHTML) {
            renderedHTML = html;
            list.innerHTML = html;
            onRender();
        }
    };
    render([]);
    let request: AbortController;
    return () => {
        request?.abort();
        request = new AbortController();
        void fetchPost("/api/system/getWorkspaces", {}, ({data}) => {
            render((data ?? []).map(workspace => workspace.path));
        }, undefined, undefined, request.signal);
    };
};
