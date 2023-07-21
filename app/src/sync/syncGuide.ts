import {needLogin, needSubscribe} from "../util/needSubscribe";
import {showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {isMobile} from "../util/functions";
import {processSync} from "../dialog/processSystem";
/// #if !MOBILE
import {openSetting} from "../config";
/// #endif
import {App} from "../index";

export const addCloudName = (cloudPanelElement: Element) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.cloudSyncDir,
        content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block" value="main">
    <div class="b3-label__text">${window.siyuan.languages.reposTip}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    const inputElement = dialog.element.querySelector("input") as HTMLInputElement;
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    dialog.bindInput(inputElement, () => {
        (btnsElement[1] as HTMLButtonElement).click();
    });
    inputElement.focus();
    inputElement.select();
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        cloudPanelElement.innerHTML = '<img style="margin: 0 auto;display: block;width: 64px;height: 100%" src="/stage/loading-pure.svg">';
        fetchPost("/api/sync/createCloudSyncDir", {name: inputElement.value}, () => {
            dialog.destroy();
            getSyncCloudList(cloudPanelElement, true);
        });
    });
};

export const bindSyncCloudListEvent = (cloudPanelElement: Element, cb?: () => void) => {
    cloudPanelElement.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(cloudPanelElement)) {
            const type = target.getAttribute("data-type");
            if (type) {
                switch (type) {
                    case "addCloud":
                        addCloudName(cloudPanelElement);
                        break;
                    case "removeCloud":
                        confirmDialog(window.siyuan.languages.confirm, `${window.siyuan.languages.confirmDeleteCloudDir} <i>${target.parentElement.getAttribute("data-name")}</i>`, () => {
                            cloudPanelElement.innerHTML = '<img style="margin: 0 auto;display: block;width: 64px;height: 100%" src="/stage/loading-pure.svg">';
                            fetchPost("/api/sync/removeCloudSyncDir", {name: target.parentElement.getAttribute("data-name")}, (response) => {
                                window.siyuan.config.sync.cloudName = response.data;
                                getSyncCloudList(cloudPanelElement, true, cb);
                            });
                        });
                        break;
                    case "selectCloud":
                        cloudPanelElement.innerHTML = '<img style="margin: 0 auto;display: block;width: 64px;height: 100%" src="/stage/loading-pure.svg">';
                        fetchPost("/api/sync/setCloudSyncDir", {name: target.getAttribute("data-name")}, () => {
                            window.siyuan.config.sync.cloudName = target.getAttribute("data-name");
                            getSyncCloudList(cloudPanelElement, true, cb);
                        });
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

export const getSyncCloudList = (cloudPanelElement: Element, reload = false, cb?: () => void) => {
    if (!reload && cloudPanelElement.firstElementChild.tagName !== "IMG") {
        return;
    }
    fetchPost("/api/sync/listCloudSyncDir", {}, (response) => {
        let syncListHTML = `<div class="fn__hr"></div><ul><li style="padding: 0 16px" class="b3-list--empty">${window.siyuan.languages.emptyCloudSyncList}</li></ul>`;
        if (response.code === 1) {
            syncListHTML = `<div class="fn__hr"></div>
<ul>
    <li class="b3-list--empty ft__error">
        ${response.msg}
    </li>
    <li class="b3-list--empty">
        ${window.siyuan.languages.cloudConfigTip}
    </li>
</ul>`;
        } else if (response.code !== 1) {
            syncListHTML = '<div class="fn__hr"></div><ul class="b3-list b3-list--background fn__flex-1" style="overflow: auto;">';
            response.data.syncDirs.forEach((item: { hSize: string, cloudName: string, updated: string }) => {
                /// #if MOBILE
                syncListHTML += `<li data-type="selectCloud" data-name="${item.cloudName}" class="b3-list-item b3-list-item--two">
    <div class="b3-list-item__first" data-name="${item.cloudName}">
        <input type="radio" name="cloudName"${item.cloudName === response.data.checkedSyncDir ? " checked" : ""}/>
        <span class="fn__space"></span>
        <span>${item.cloudName}</span>
        <span class="fn__flex-1 fn__space"></span>
        <span data-type="removeCloud" class="b3-list-item__action">
            <svg><use xlink:href="#iconTrashcan"></use></svg>
        </span>
    </div>
    <div class="b3-list-item__meta fn__flex">
        <span>${item.hSize}</span>
        <span class="fn__flex-1 fn__space"></span>
        <span>${item.updated}</span>
    </div>
</li>`;
                /// #else
                syncListHTML += `<li data-type="selectCloud" data-name="${item.cloudName}" class="b3-list-item b3-list-item--hide-action">
<input type="radio" name="cloudName"${item.cloudName === response.data.checkedSyncDir ? " checked" : ""}/>
<span class="fn__space"></span>
<span>${item.cloudName}</span>
<span class="fn__space"></span>
<span class="ft__on-surface">${item.hSize}</span>
<span class="b3-list-item__meta">${item.updated}</span>
<span class="fn__flex-1 fn__space"></span>
<span data-type="removeCloud" class="b3-tooltips b3-tooltips__w b3-list-item__action" aria-label="${window.siyuan.languages.delete}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span></li>`;
                /// #endif
            });
            syncListHTML += `</ul>
<div class="fn__hr"></div>
<div class="fn__flex">
    <div class="fn__flex-1"></div>
    <button class="b3-button b3-button--outline" data-type="addCloud"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.addAttr}</button>
</div>`;
        }
        cloudPanelElement.innerHTML = syncListHTML;
        if (cb) {
            cb();
        }
    });
};

export const syncGuide = (app?: App) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    /// #if MOBILE
    if ((0 === window.siyuan.config.sync.provider && needSubscribe()) ||
        (0 !== window.siyuan.config.sync.provider && needLogin())) {
        return;
    }
    /// #else
    if (document.querySelector("#barSync")?.classList.contains("toolbar__item--active")) {
        return;
    }
    if (0 === window.siyuan.config.sync.provider && needSubscribe("") && app) {
        const dialogSetting = openSetting(app);
        if (window.siyuan.user) {
            dialogSetting.element.querySelector('.b3-tab-bar [data-name="repos"]').dispatchEvent(new CustomEvent("click"));
        } else {
            dialogSetting.element.querySelector('.b3-tab-bar [data-name="account"]').dispatchEvent(new CustomEvent("click"));
            dialogSetting.element.querySelector('.config__tab-container[data-name="account"]').setAttribute("data-action", "go-repos");
        }
        return;
    }
    if (0 !== window.siyuan.config.sync.provider && needLogin("") && app) {
        const dialogSetting = openSetting(app);
        dialogSetting.element.querySelector('.b3-tab-bar [data-name="account"]').dispatchEvent(new CustomEvent("click"));
        dialogSetting.element.querySelector('.config__tab-container[data-name="account"]').setAttribute("data-action", "go-repos");
        return;
    }
    /// #endif
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
    if (window.siyuan.config.sync.mode !== 3) {
        fetchPost("/api/sync/performSync", {});
        return;
    }
    const manualDialog = new Dialog({
        title: window.siyuan.languages.chooseSyncDirection,
        content: `<div class="b3-dialog__content">
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
        fetchPost("/api/sync/performSync", {upload: uploadElement.value === "true"});
        manualDialog.destroy();
    });
};

const setSync = (key?: string, dialog?: Dialog) => {
    if (key) {
        window.siyuan.config.repo.key = key;
    }
    if (!window.siyuan.config.sync.enabled) {
        const listHTML = `<div class="b3-dialog__content">
    <div class="ft__on-surface">${window.siyuan.languages.syncConfGuide3}</div>
    <div style="display: flex;flex-direction: column;height: 40vh;">
        <img style="margin: 0 auto;display: block;width: 64px;height: 100%" src="/stage/loading-pure.svg">
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button" disabled="disabled">${window.siyuan.languages.openSyncTip1}</button>
</div>`;
        if (dialog) {
            dialog.element.querySelector(".b3-dialog__header").innerHTML = window.siyuan.languages.cloudSyncDir;
            dialog.element.querySelector(".b3-dialog__body").innerHTML = listHTML;
        } else {
            dialog = new Dialog({
                title: window.siyuan.languages.cloudSyncDir,
                content: listHTML,
                width: isMobile() ? "92vw" : "520px",
            });
        }
        const contentElement = dialog.element.querySelector(".b3-dialog__content").lastElementChild;
        const btnElement = dialog.element.querySelector(".b3-button");
        bindSyncCloudListEvent(contentElement, () => {
            if (contentElement.querySelector("input[checked]")) {
                btnElement.removeAttribute("disabled");
            } else {
                btnElement.setAttribute("disabled", "disabled");
            }
        });
        getSyncCloudList(contentElement, false, () => {
            if (contentElement.querySelector("input[checked]")) {
                btnElement.removeAttribute("disabled");
            } else {
                btnElement.setAttribute("disabled", "disabled");
            }
        });
        btnElement.addEventListener("click", () => {
            dialog.destroy();
            fetchPost("/api/sync/setSyncEnable", {enabled: true}, () => {
                window.siyuan.config.sync.enabled = true;
                processSync();
                confirmDialog(window.siyuan.languages.syncConfGuide4, window.siyuan.languages.syncConfGuide5, () => {
                    syncNow();
                });
            });
        });
    } else {
        if (dialog) {
            dialog.destroy();
        }
        confirmDialog(window.siyuan.languages.syncConfGuide4, window.siyuan.languages.syncConfGuide5, () => {
            syncNow();
        });
    }
};

export const setKey = (isSync: boolean, cb?: () => void) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.syncConfGuide1,
        content: `<div class="b3-dialog__content ft__center">
    <img style="width: 260px" src="/stage/images/sync-guide.svg"/>
    <div class="fn__hr--b"></div>
    <div class="ft__on-surface">${window.siyuan.languages.syncConfGuide2}</div>
    <div class="fn__hr--b"></div>
    <input class="b3-text-field fn__block ft__center" placeholder="${window.siyuan.languages.passphrase}">
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block ft__center" placeholder="${window.siyuan.languages.duplicate} ${window.siyuan.languages.passphrase}">
</div>
<div class="b3-dialog__action">
    <label>
        <input type="checkbox" class="b3-switch fn__flex-center">
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
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => {
        dialog.destroy();
    });
    const genBtnElement = dialog.element.querySelector("#initKeyByPW");
    dialog.element.querySelector(".b3-switch").addEventListener("change", function () {
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
        confirmDialog("🔑 " + window.siyuan.languages.genKeyByPW, window.siyuan.languages.initRepoKeyTip, () => {
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
    inputElements[0].focus();
};
