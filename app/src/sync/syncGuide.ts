import {needSubscribe} from "../util/needSubscribe";
import {showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {isMobile} from "../util/functions";
import {account} from "../config/account";
import {processSync} from "../dialog/processSystem";

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
        width: isMobile() ? "80vw" : "520px",
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

export const bindSyncCloudListEvent = (cloudPanelElement: Element) => {
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
                                getSyncCloudList(cloudPanelElement, true);
                            });
                        });
                        break;
                    case "selectCloud":
                        cloudPanelElement.innerHTML = '<img style="margin: 0 auto;display: block;width: 64px;height: 100%" src="/stage/loading-pure.svg">';
                        fetchPost("/api/sync/setCloudSyncDir", {name: target.getAttribute("data-name")}, () => {
                            window.siyuan.config.sync.cloudName = target.getAttribute("data-name");
                            getSyncCloudList(cloudPanelElement, true);
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
            syncListHTML = `<div class="fn__hr"></div><ul><li style="padding: 0 16px" class="b3-list--empty ft__error">${response.msg}</li></ul>`;
        } else if (response.code !== 1) {
            syncListHTML = '<div class="fn__hr"></div><ul class="b3-list b3-list--background fn__flex-1" style="overflow: auto;">';
            response.data.syncDirs.forEach((item: { hSize: string, cloudName: string, updated: string }) => {
                syncListHTML += `<li data-type="selectCloud" data-name="${item.cloudName}" class="b3-list-item${isMobile() ? "" : " b3-list-item--hide-action"}">
<input type="radio" name="cloudName"${item.cloudName === response.data.checkedSyncDir ? " checked" : ""}/>
<span class="fn__space"></span>
<span>${item.cloudName}</span>
<span class="fn__space"></span>
<span class="ft__on-surface">${item.hSize}</span>
<span class="b3-list-item__meta${isMobile() ? " fn__none" : ""}">${item.updated}</span>
<span class="fn__flex-1 fn__space"></span>
<span data-type="removeCloud" class="b3-tooltips b3-tooltips__w b3-list-item__action" aria-label="${window.siyuan.languages.delete}">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
</span></li>`;
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

export const syncGuide = (element?: Element) => {
    if (element && element.classList.contains("toolbar__item--active")) {
        return;
    }
    if (isMobile()) {
        if (0 === window.siyuan.config.sync.provider && needSubscribe()) {
            return;
        }
    } else if (0 === window.siyuan.config.sync.provider && needSubscribe("")) {
        const dialog = new Dialog({
            title: window.siyuan.languages.account,
            content: `<div class="account" style="background-color: var(--b3-theme-background)">${account.genHTML()}</div>`,
            width: "80vw",
        });
        account.bindEvent(dialog.element.querySelector(".account"));
        return;
    }
    if (!window.siyuan.config.repo.key) {
        setKey();
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
        width: isMobile() ? "80vw" : "520px",
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
}

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
            dialog.element.querySelector(".b3-dialog__container").lastElementChild.innerHTML = listHTML;
        } else {
            dialog = new Dialog({
                title: window.siyuan.languages.cloudSyncDir,
                content: listHTML,
                width: isMobile() ? "80vw" : "520px",
            });
        }
        const contentElement = dialog.element.querySelector(".b3-dialog__content").lastElementChild;
        bindSyncCloudListEvent(contentElement);
        const btnElement = dialog.element.querySelector(".b3-button");
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

const setKey = () => {
    const dialog = new Dialog({
        title: window.siyuan.languages.syncConfGuide1,
        content: `<div class="b3-dialog__content ft__center">
    <img style="width: 260px" src="/stage/images/sync-guide.svg"/>
    <div class="fn__hr--b"></div>
    <div class="ft__on-surface">${window.siyuan.languages.syncConfGuide2}</div>
     <div class="fn__hr--b"></div>
    <input class="b3-text-field fn__block ft__center" placeholder="${window.siyuan.languages.passphrase}">
    <div class="fn__hr"></div>
    <button class="b3-button fn__block" id="initKeyByPW">
        <svg><use xlink:href="#iconHand"></use></svg>${window.siyuan.languages.genKeyByPW}
    </button>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
</div>`,
        width: isMobile() ? "80vw" : "520px",
    });
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => {
        dialog.destroy();
    });
    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
    dialog.element.querySelector("#initKeyByPW").addEventListener("click", () => {
        if (!inputElement.value) {
            showMessage(window.siyuan.languages._kernel[142]);
            return;
        }
        confirmDialog("🔑 " + window.siyuan.languages.genKeyByPW, window.siyuan.languages.initRepoKeyTip, () => {
            fetchPost("/api/repo/initRepoKeyFromPassphrase", {pass: inputElement.value}, (response) => {
                setSync(response.data.key, dialog);
            });
        });
    });
    inputElement.focus();
};
