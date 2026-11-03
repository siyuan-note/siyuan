import {MobileDialog} from "../dialog/mobileDialog";
import {mobileConfirmDialog} from "../dialog/mobileConfirmDialog";
import {mobileInputDialog} from "../dialog/mobileInputDialog";
import {config as configApi} from "../config/util/configApi";
import {isPaidUser, needSubscribe} from "../util/needSubscribe";
import {showMessage} from "../dialog/message";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {processSync} from "../dialog/processSystem";
import {openSyncCheckoutProgress} from "./checkoutProgress";
/// #if !MOBILE
import {openSetting} from "../config";
/// #endif
import type {App} from "../index";
import {Constants} from "../constants";
import {getCloudURL} from "../config/util/about";
import {sanitizeKernelHTML} from "../util/hostCapabilities";
import {escapeHtml} from "../util/escape";

const pendingCloudLists = new WeakSet<Element>();
const cloudListRequests = new WeakMap<Element, object>();
const cloudListReady = new WeakMap<Element, boolean>();

const runCloudListAction = async (element: Element, action: () => Promise<boolean>, cb?: (ready: boolean) => void) => {
    if (pendingCloudLists.has(element)) return false;
    pendingCloudLists.add(element);
    const inert = element.hasAttribute("inert");
    element.setAttribute("inert", "");
    element.setAttribute("aria-busy", "true");
    try {
        cb?.(false);
        return await action();
    } catch (error) {
        showMessage(error?.message || window.siyuan.languages.loadingError);
        return false;
    } finally {
        pendingCloudLists.delete(element);
        if (!inert) element.removeAttribute("inert");
        element.removeAttribute("aria-busy");
        cb?.(cloudListReady.get(element) === true);
    }
};

const openSyncSetting = (app?: App) => {
    if (!app) {
        return;
    }
    /// #if MOBILE
    void import("../mobile/menu").then(({openMobileSetting}) => openMobileSetting(app, "sync"));
    /// #else
    openSetting(app, "sync");
    /// #endif
};

export const addCloudName = (cloudListElement: Element, cb?: (ready: boolean) => void) => {
    const dialog = mobileInputDialog({
        awaitConfirm: true,
        title: window.siyuan.languages.cloudSyncDir,
        value: "main",
        description: window.siyuan.languages.reposTip,
        onConfirm: value => runCloudListAction(cloudListElement, async () => {
            const response = await fetchSyncPost("/api/sync/createCloudSyncDir", {name: value});
            if (response.code !== 0) return false;
            if (cloudListElement.isConnected) renderSyncCloudList(cloudListElement, true, cb);
            return true;
        }, cb),
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_SYNCADDCLOUDDIR);
};

export const bindSyncCloudListEvent = (cloudListElement: Element, cb?: (ready: boolean) => void) => {
    cloudListElement.addEventListener("click", (event) => {
        if (window.siyuan.config.sync.provider === 2) {
            return;
        }
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(cloudListElement)) {
            const type = target.getAttribute("data-type");
            if (type) {
                switch (type) {
                    case "addCloud":
                        addCloudName(cloudListElement, cb);
                        break;
                    case "retryCloud":
                        renderSyncCloudList(cloudListElement, true, cb);
                        break;
                    case "removeCloud":
                        mobileConfirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.confirmDeleteCloudDir} <i>${target.parentElement.getAttribute("data-name")}</i>`,
                            () => runCloudListAction(cloudListElement, async () => {
                                const response = await fetchSyncPost("/api/sync/removeCloudSyncDir", {name: target.parentElement.getAttribute("data-name")});
                                if (response.code !== 0) return false;
                                window.siyuan.config.sync.cloudName = response.data;
                                if (cloudListElement.isConnected) renderSyncCloudList(cloudListElement, true, cb);
                                return true;
                            }, cb), undefined, true, undefined, undefined, {awaitConfirm: true});
                        break;
                    case "selectCloud":
                        void runCloudListAction(cloudListElement, async () => {
                            await configApi.set("sync.cloudName", target.getAttribute("data-name"), () => {
                                if (cloudListElement.isConnected) renderSyncCloudList(cloudListElement, true, cb);
                            });
                            return true;
                        }, cb);
                        break;
                }
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
};

export const renderSyncCloudList = (cloudListElement: Element, reload = false, cb?: (ready: boolean) => void) => {
    const provider = window.siyuan.config.sync.provider;
    const updateReady = (ready: boolean) => {
        cloudListReady.set(cloudListElement, ready);
        cb?.(ready);
    };
    const request = {};
    cloudListRequests.set(cloudListElement, request);
    const isCurrent = () => cloudListElement.isConnected && provider === window.siyuan.config.sync.provider &&
        cloudListRequests.get(cloudListElement) === request;
    const failed = (message: string, configure = false) => {
        if (!isCurrent()) return;
        cloudListElement.innerHTML = `<ul><li class="b3-list--empty ft__error">${sanitizeKernelHTML(message || window.siyuan.languages.loadingError)}</li>${configure ? `<li class="b3-list--empty">${window.siyuan.languages.cloudConfigTip}</li>` : ""}</ul>
<button class="b3-button b3-button--outline" data-type="retryCloud">${window.siyuan.languages.retry}</button>`;
        updateReady(false);
    };
    if (provider === 2) {
        // S3 使用配置的存储桶，不依赖列出所有存储桶的权限；实际访问错误由同步请求报告。
        const s3 = window.siyuan.config.sync.s3;
        const ready = !!s3 && [s3.endpoint, s3.accessKey, s3.secretKey, s3.bucket, s3.region]
            .every(value => !!value?.trim());
        // S3 不使用云端同步目录，仅为与其他提供商保持一致的列表样式而显示唯一的固定项
        cloudListElement.innerHTML = ready ? `<div class="fn__hr"></div><ul class="b3-list b3-list--background" style="overflow: auto;">
    <li class="b3-list-item b3-list-item--narrow b3-list-item--hide-action">
        <input type="radio" name="cloudName" checked/><span class="fn__space"></span><span>${escapeHtml(s3.bucket)}</span>
    </li>
</ul>` : `<ul><li class="b3-list--empty">${window.siyuan.languages.cloudConfigTip}</li></ul>`;
        updateReady(ready);
        return;
    }
    if (!reload && cloudListElement.querySelector("ul")) {
        return;
    }
    const canManage = provider === 0 || provider === 4;
    updateReady(false);
    cloudListElement.innerHTML = '<div class="fn__flex" style="height:100%;align-items:center;justify-content:center"><span class="b3-loading" aria-hidden="true"></span></div>';
    void fetchSyncPost("/api/sync/listCloudSyncDir", {}, undefined, false).then(response => {
        if (!isCurrent()) return;
        if (response.code !== 0) {
            failed(response.msg, response.code === 1);
            return;
        }
        let ready = false;
        const syncListParts: string[] = ["<div class=\"fn__hr\"></div><ul class=\"b3-list b3-list--background\" style=\"overflow: auto;\">"];
        if (response.data.syncDirs.length === 0) {
            syncListParts.push(`<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`);
        }
        response.data.syncDirs.forEach((item: { hSize: string, cloudName: string, updated: string }) => {
            const checked = item.cloudName === response.data.checkedSyncDir;
            ready = ready || checked;
            const rowAttributes = ` data-type="selectCloud" data-name="${item.cloudName}"`;
            const radioHTML = `<input type="radio" name="cloudName"${checked ? " checked" : ""}/><span class="fn__space"></span>`;
            /// #if MOBILE
            syncListParts.push(`<li${rowAttributes} class="b3-list-item b3-list-item--two">
<div class="b3-list-item__first" data-name="${item.cloudName}">
    ${radioHTML}
    <span>${item.cloudName}</span>
    <span class="fn__flex-1 fn__space"></span>
    ${canManage ? `<span data-type="removeCloud" class="b3-list-item__action">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>` : ""}
</div>
<div class="b3-list-item__meta fn__flex">
    <span class="fn__space"></span>
    <span class="fn__space"></span>
    <span class="fn__space"></span>
    <span>${item.hSize}</span>
    <span class="fn__space"></span>
    <span>${item.updated}</span>
</div>
</li>`);
            /// #else
            syncListParts.push(`<li${rowAttributes} class="b3-list-item b3-list-item--narrow b3-list-item--hide-action">
${radioHTML}
<span>${item.cloudName}</span>
<span class="fn__space"></span>
<span class="ft__on-surface">${item.hSize}</span>
<span class="b3-list-item__meta">${item.updated}</span>
<span class="fn__flex-1 fn__space"></span>
${canManage ? `<span data-type="removeCloud" class="b3-tooltips b3-tooltips__w b3-list-item__action" aria-label="${window.siyuan.languages.delete}">
<svg><use xlink:href="#iconTrashcan"></use></svg>
</span>` : ""}</li>`);
            /// #endif
        });
        syncListParts.push("</ul>");
        if (canManage) {
            syncListParts.push(`<div class="fn__hr"></div>
<div class="fn__flex">
<button class="b3-button b3-button--outline" data-type="addCloud"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.addAttr}</button>
<div class="fn__flex-1"></div>
</div>`);
        }
        cloudListElement.innerHTML = syncListParts.join("");
        updateReady(ready);
    }).catch(error => failed(error?.message));
};

/** S3 直接展示配置的存储桶，其他提供者通过“配置”按钮展开目录列表 */
export const refreshSyncCloudDirBlock = (root: Element) => {
    const blockElement = root.querySelector("#syncCloudDirBlock");
    const listElement = root.querySelector("#syncCloudList");
    if (!blockElement || !listElement) {
        return;
    }
    const isS3 = window.siyuan.config.sync.provider === 2;
    blockElement.querySelector('[data-action="config"]')?.classList.toggle("fn__none", isS3);
    listElement.innerHTML = "";
    listElement.classList.toggle("fn__none", !isS3);
    if (isS3) {
        renderSyncCloudList(listElement, true);
    }
};

export const syncGuide = (app?: App) => {
    if (openSyncCheckoutProgress()) return;
    if (window.siyuan.config.readonly) {
        return;
    }
    if (app && document.querySelector("#barSync")?.classList.contains("toolbar__item--active")) {
        return;
    }
    if (window.siyuan.config.sync.provider === 0 && needSubscribe()) {
        openSyncSetting(app);
        showMessage(window.siyuan.languages._kernel[29].replaceAll("${accountServer}", getCloudURL("")));
        return;
    } else if (!isPaidUser()) {
        openSyncSetting(app);
        showMessage(window.siyuan.languages._kernel[214].replaceAll("${accountServer}", getCloudURL("")));
        return;
    }
    if (!window.siyuan.config.sync.enabled && window.siyuan.config.sync.provider !== 0) {
        openSyncSetting(app);
        return;
    }
    if (!window.siyuan.config.repo.key) {
        setKey(true);
        return;
    }
    if (!window.siyuan.config.sync.enabled) {
        setSync();
        return;
    }
    syncNow();
};

const syncNow = () => {
    fetchPost("/api/sync/getSyncSourceState", {}, response => {
		if (response.data.source && !response.data.cloudID) {
			fetchPost("/api/sync/performSync", {upload: true, source: response.data.source,
				localID: response.data.localID, cloudID: ""});
			return;
		}
        if (!response.data.pending && window.siyuan.config.sync.mode !== 3) {
            fetchPost("/api/sync/performSync", {});
            return;
        }
        chooseSyncDirection(response.data);
    });
};

const chooseSyncDirection = (state: import("../types/api").SyncSourceState) => {
    const values: Record<string, string | number> = {
        local: state.localFiles, cloud: state.cloudFiles, time: new Date(state.cloudCreated).toLocaleString(),
        device: state.cloudDevice, upload: state.uploadFiles, overwrite: state.overwriteFiles, remove: state.removeFiles,
    };
    const preview = state.pending ? window.siyuan.languages.syncSourcePreview.replace(/\$\{(\w+)\}/g,
        (_match: string, key: string) => escapeHtml(String(values[key]))) : "";
    const manualDialog = new MobileDialog({
        mobileSheet: {expandable: true},
        title: window.siyuan.languages.chooseSyncDirection,
        content: `<div class="b3-dialog__content">
    ${preview ? `<div class="b3-label">${preview}</div>` : ""}
    <label class="fn__flex b3-label">
        <input type="radio" name="upload" value="true">
        <span class="fn__space"></span>
        <div>
            ${window.siyuan.languages.uploadData2Cloud}
            <div class="b3-label__text">${window.siyuan.languages.uploadData2CloudTip}</div>
        </div>
    </label>
    <label class="fn__flex b3-label">
        <input type="radio" name="upload" value="false">
        <span class="fn__space"></span>
        <div>
            ${window.siyuan.languages.downloadDataFromCloud}
            <div class="b3-label__text">${window.siyuan.languages.downloadDataFromCloudTip}</div>
        </div>
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    manualDialog.element.setAttribute("data-key", Constants.DIALOG_SYNCCHOOSEDIRECTION);
    const btnsElement = manualDialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        manualDialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        const uploadElement = manualDialog.element.querySelector("input[name=upload]:checked") as HTMLInputElement;
        if (!uploadElement) {
            showMessage(window.siyuan.languages.plsChoose);
            return;
        }
        void manualDialog.runPending(async () => {
            const response = await fetchSyncPost("/api/sync/performSync", {
                upload: uploadElement.value === "true",
                ...(state.pending ? {source: state.source, localID: state.localID, cloudID: state.cloudID} : {}),
            });
            return response.code === 0;
        });
    });
};

const setSync = (key?: string, dialog?: MobileDialog) => {
    if (key) {
        window.siyuan.config.repo.key = key;
    }
    if (!window.siyuan.config.sync.enabled) {
        const listHTML = `<div class="b3-dialog__content">
    <div class="ft__on-surface">${window.siyuan.languages.syncConfGuide3}</div>
    <div style="display: flex;flex-direction: column;${isMobile() ? "max-height" : "height"}: 40vh;">
        <div class="fn__flex" style="height:100%;align-items:center;justify-content:center"><span class="b3-loading" aria-hidden="true"></span></div>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button" disabled>${window.siyuan.languages.openSyncTip1}</button>
</div>`;
        if (dialog) {
            dialog.element.querySelector(".b3-dialog__header").innerHTML = "🗂️ " + window.siyuan.languages.cloudSyncDir;
            dialog.element.querySelector(".b3-dialog__body").innerHTML = listHTML;
        } else {
            dialog = new MobileDialog({
                mobileSheet: {expandable: true},
                title: "🗂️ " + window.siyuan.languages.cloudSyncDir,
                content: listHTML,
                width: isMobile() ? "92vw" : "520px",
            });
        }
        dialog.element.setAttribute("data-key", Constants.DIALOG_SYNCCHOOSEDIR);
        const contentElement = dialog.element.querySelector(".b3-dialog__content").lastElementChild;
        const btnElement = dialog.element.querySelector(".b3-button") as HTMLButtonElement;
        const updateOpenSyncBtn = (ready: boolean) => {
            btnElement.disabled = !ready;
        };
        bindSyncCloudListEvent(contentElement, updateOpenSyncBtn);
        renderSyncCloudList(contentElement, false, updateOpenSyncBtn);
        btnElement.addEventListener("click", () => {
            void dialog.runPending(async () => {
                await configApi.set("sync.enabled", true, () => {
                    window.siyuan.config.sync.enabled = true;
                    processSync();
                });
                return window.siyuan.config.sync.enabled;
            }, {close: false}).then(success => {
                if (!success) return;
                dialog.destroy();
                mobileConfirmDialog("🔄 " + window.siyuan.languages.syncConfGuide4, window.siyuan.languages.syncConfGuide5, () => {
                    syncNow();
                });
            });
        });
    } else {
        if (dialog) {
            dialog.destroy();
        }
        mobileConfirmDialog("🔄 " + window.siyuan.languages.syncConfGuide4, window.siyuan.languages.syncConfGuide5, () => {
            syncNow();
        });
    }
};

export const setKey = (isSync: boolean, cb?: () => void) => {
    const dialog = new MobileDialog({
        mobileSheet: {expandable: true},
        title: "🔑 " + window.siyuan.languages.syncConfGuide1,
        content: `<div class="b3-dialog__content ft__center">
    <img style="width: 260px" src="/stage/images/sync-guide.svg"/>
    <div class="fn__hr--b"></div>
    <div class="ft__on-surface">${window.siyuan.languages.syncConfGuide2}</div>
    <div class="fn__hr--b"></div>
    <input class="b3-text-field fn__block ft__center" placeholder="${window.siyuan.languages.passphrase}">
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block ft__center" placeholder="${window.siyuan.languages.reEnterPassphrase}">
</div>
<div class="b3-dialog__action">
    <label style="display: inline-flex; align-items: center; cursor: pointer;">
        <input type="checkbox" id="confirmPassword">
        <span class="fn__space"></span>
        ${window.siyuan.languages.confirmPassword}
    </label>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--text" id="initKeyByPW" disabled>
        ${window.siyuan.languages.confirm}
    </button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_SETPASSWORD);
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => {
        dialog.destroy();
    });
    const genBtnElement = dialog.element.querySelector("#initKeyByPW");
    dialog.element.querySelector("#confirmPassword").addEventListener("change", function () {
        if (this.checked) {
            genBtnElement.removeAttribute("disabled");
        } else {
            genBtnElement.setAttribute("disabled", "disabled");
        }
    });
    const inputElements = dialog.element.querySelectorAll(".b3-text-field") as NodeListOf<HTMLInputElement>;
    genBtnElement.addEventListener("click", () => {
        if (!inputElements[0].value || !inputElements[1].value) {
            showMessage(window.siyuan.languages._kernel[142]);
            return;
        }
        if (inputElements[0].value !== inputElements[1].value) {
            showMessage(window.siyuan.languages.passwordNoMatch);
            return;
        }
        mobileConfirmDialog("🔑 " + window.siyuan.languages.genKeyByPW, window.siyuan.languages.initRepoKeyTip, () => {
            if (isMobile()) {
                void dialog.runPending(async () => {
                    const response = await fetchSyncPost("/api/repo/initRepoKeyFromPassphrase", {pass: inputElements[0].value});
                    if (response.code !== 0) return false;
                    window.siyuan.config.repo.key = response.data.key;
                    cb?.();
                    return true;
                }, {close: false}).then(success => {
                    if (!success) return;
                    if (isSync) setSync(window.siyuan.config.repo.key, dialog);
                    else dialog.destroy();
                });
                return;
            }
            if (!isSync) {
                dialog.destroy();
            }
            fetchPost("/api/repo/initRepoKeyFromPassphrase", {pass: inputElements[0].value}, (response) => {
                window.siyuan.config.repo.key = response.data.key;
                if (cb) {
                    cb();
                }
                if (isSync) {
                    setSync(response.data.key, dialog);
                }
            });
        });
    });
    dialog.focusWhenReady(() => inputElements[0]);
};
