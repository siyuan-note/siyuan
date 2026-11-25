import {switchWorkspace} from "../../config/util/resourceConfig";
import {Constants} from "../../constants";
import {AdaptiveDialog} from "../../dialog/adaptiveDialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {openInputDialog} from "../../dialog/inputDialog";
import {isInMobileApp} from "../../protyle/util/compatibility";
import {escapeHtmlTextAndAttr} from "../../util/escape";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {getHostCapabilities} from "../../util/hostCapabilities";
import {pathPosix} from "../../util/pathName";

export const canManageMobileWorkspaces = () =>
    isInMobileApp() && !window.siyuan.config.readonly && !window.siyuan.isPublish && getHostCapabilities().workspaces;

export const confirmMobileWorkspaceSwitch = (path: string) => {
    if (!canManageMobileWorkspaces() || path === window.siyuan.config.system.workspaceDir) {
        return;
    }
    const {languages} = window.siyuan;
    const name = escapeHtmlTextAndAttr(pathPosix().basename(path));
    confirmDialog({
        title: languages.mobileWorkspaceSwitchTitle.replace("${x}", () => name),
        text: languages.mobileWorkspaceSwitchTip,
        confirmLabel: languages.mobileWorkspaceSwitch,
        confirm: () => switchWorkspace(path),
    });
};

export const renderMobileWorkspaceManager = () => `<div class="b3-label config-item">
    <button type="button" data-type="open-workspace" class="b3-button b3-button--outline fn__block">${window.siyuan.languages.openBy}...</button>
    <div class="fn__hr--small"></div>
    <ul data-workspace-list class="b3-list b3-list--background"></ul>
    <div class="fn__hr--small"></div>
    <button type="button" data-type="create-workspace" class="b3-button fn__block">${window.siyuan.languages.new}</button>
</div>`;

const renderWorkspaceList = (workspaceDirElement: Element) => {
    fetchPost("/api/system/getWorkspaces", {}, (response) => {
        let html = "";
        (response.data ?? []).forEach(item => {
            html += `<li data-path="${escapeHtmlTextAndAttr(item.path)}" class="b3-list-item b3-list-item--narrow${window.siyuan.config.system.workspaceDir === item.path ? " b3-list-item--focus" : ""}">
    <span class="b3-list-item__text">${escapeHtmlTextAndAttr(pathPosix().basename(item.path))}</span>
    <span data-type="remove" class="b3-list-item__action">
        <svg><use xlink:href="#iconMin"></use></svg>
    </span>
</li>`;
        });
        workspaceDirElement.innerHTML = html;
    });
};

export const mountMobileWorkspaceManager = (root: HTMLElement) => {
    if (!canManageMobileWorkspaces()) {
        return;
    }
    const workspaceDirElement = root.querySelector("[data-workspace-list]");
    if (!workspaceDirElement) {
        return;
    }
    renderWorkspaceList(workspaceDirElement);
    root.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && target !== root) {
            const type = target.getAttribute("data-type");
            if (type === "open-workspace") {
                fetchPost("/api/system/getMobileWorkspaces", {}, (response) => {
                    if (!root.isConnected || root.dataset.dialogClosing === "true") {
                        return;
                    }
                    let selectHTML = "";
                    (response.data ?? []).forEach((item, index) => {
                        selectHTML += `<option value="${escapeHtmlTextAndAttr(item)}"${index === 0 ? " selected" : ""}>${escapeHtmlTextAndAttr(pathPosix().basename(item))}</option>`;
                    });
                    const openWorkspaceDialog = new AdaptiveDialog({
                        title: window.siyuan.languages.openBy,
                        content: `<div class="b3-dialog__content">
    <select class="b3-text-field fn__block">${selectHTML}</select>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                        width: "92vw",
                    });
                    openWorkspaceDialog.element.setAttribute("data-key", Constants.SIYUAN_OPEN_WORKSPACE);
                    const btnsElement = openWorkspaceDialog.element.querySelectorAll(".b3-button");
                    btnsElement[0].addEventListener("click", () => {
                        openWorkspaceDialog.destroy();
                    });
                    btnsElement[1].addEventListener("click", () => {
                        const openPath = (openWorkspaceDialog.element.querySelector("select") as HTMLSelectElement).value;
                        if (!openPath || openPath === window.siyuan.config.system.workspaceDir) {
                            openWorkspaceDialog.destroy();
                            return;
                        }
                        confirmMobileWorkspaceSwitch(openPath);
                    });
                });
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (type === "create-workspace") {
                const createWorkspaceDialog = openInputDialog({
                    awaitConfirm: true,
                    title: window.siyuan.languages.new,
                    value: "",
                    onConfirm: async (value) => {
                        const response = await fetchSyncPost("/api/system/createWorkspaceDir", {
                            path: pathPosix().join(pathPosix().dirname(window.siyuan.config.system.workspaceDir), value),
                        });
                        if (response.code !== 0) return false;
                        renderWorkspaceList(workspaceDirElement);
                        return true;
                    },
                });
                createWorkspaceDialog.element.setAttribute("data-key", Constants.DIALOG_CREATEWORKSPACE);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (type === "remove") {
                const removePath = target.parentElement?.getAttribute("data-path");
                if (!removePath) {
                    break;
                }
                event.preventDefault();
                event.stopPropagation();
                if (removePath === window.siyuan.config.system.workspaceDir) {
                    fetchPost("/api/system/removeWorkspaceDir", {path: removePath});
                    break;
                }
                confirmDialog({
                    title: window.siyuan.languages.deleteOpConfirm,
                    text: window.siyuan.languages.removeWorkspacePhysically.replace("${x}", () => escapeHtmlTextAndAttr(removePath)),
                    confirm: async () => {
                        const response = await fetchSyncPost("/api/system/removeWorkspaceDirPhysically", {path: removePath});
                        if (response.code !== 0) return false;
                        renderWorkspaceList(workspaceDirElement);
                        return true;
                    },
                    cancel: () => {
                        fetchPost("/api/system/removeWorkspaceDir", {path: removePath}, () => {
                            renderWorkspaceList(workspaceDirElement);
                        });
                    },
                    isDelete: true,
                });
                break;
            } else if (target.classList.contains("b3-list-item") && !target.classList.contains("b3-list-item--focus")) {
                const workspacePath = target.getAttribute("data-path");
                if (!workspacePath) {
                    break;
                }
                confirmMobileWorkspaceSwitch(workspacePath);
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
};

export const openMobileWorkspaceManager = (onClose?: () => void) => {
    if (!canManageMobileWorkspaces()) {
        return;
    }
    const dialog = new AdaptiveDialog({
        title: window.siyuan.languages.workspaceList,
        content: `<div class="b3-dialog__content">${renderMobileWorkspaceManager()}</div>`,
        width: "92vw",
        destroyCallback: onClose,
    });
    mountMobileWorkspaceManager(dialog.element);
};
