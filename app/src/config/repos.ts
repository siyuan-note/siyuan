import {confirmDialog} from "../dialog/confirmDialog";
import {needSubscribe} from "../util/needSubscribe";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
/// #if !MOBILE
import {exportLayout} from "../layout/util";
/// #endif
import {Dialog} from "../dialog";
import {showMessage} from "../dialog/message";
import {exitSiYuan} from "../dialog/processSystem";

const getCloudList = (reload = false) => {
    const listElement = repos.element.querySelector("#reposCloudSyncList");
    if (!reload && listElement.firstElementChild.tagName !== "IMG") {
        return;
    }
    fetchPost("/api/sync/listCloudSyncDir", {}, (response) => {
        let syncListHTML = `<div class="fn__hr"></div><ul><li style="padding: 0 16px" class="b3-list--empty">${window.siyuan.languages.emptyCloudSyncList}</li></ul>`;
        if (response.code !== 1) {
            syncListHTML = '<div class="fn__hr"></div><ul class="b3-list b3-list--background fn__flex-1" style="overflow: auto;">';
            response.data.syncDirs.forEach((item: { hSize: string, cloudName: string, updated: string }) => {
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
            });
            syncListHTML += `</ul>
<div class="fn__hr"></div>
<div class="fn__flex">
    <div class="fn__flex-1"></div>
    <button class="b3-button" data-type="addCloud"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.addAttr}</button>
</div>`;
        }
        listElement.innerHTML = syncListHTML;
    });
};

const renderCloudBackup = () => {
    fetchPost("/api/cloud/getCloudSpace", {}, (response) => {
        repos.element.querySelector("#reposLoading").classList.add("fn__none");
        if (response.code === 1) {
            repos.element.querySelector("#reposData").innerHTML = response.msg;
            return;
        } else {
            repos.element.querySelector("#reposData").innerHTML = `<div class="fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.cloudStorage}
        <div class="fn__hr"></div>
        <ul class="b3-list">
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.sync}<span class="b3-list-item__meta">${response.data.sync ? response.data.sync.hSize : "0B"}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.backup}<span class="b3-list-item__meta">${response.data.backup ? response.data.backup.hSize : "0B"}</span></li>
            <li class="b3-list-item" style="cursor: auto;"><a href="https://ld246.com/settings/file?type=3" target="_blank">${window.siyuan.languages.cdn}</a><span class="b3-list-item__meta">${response.data.hAssetSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.total}<span class="b3-list-item__meta">${response.data.hSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.sizeLimit}<span class="b3-list-item__meta">${response.data.hTotalSize}</span></li>
        </ul>
    </div>
    <div class="fn__flex-1">
        ${window.siyuan.languages.trafficStat}
        <div class="fn__hr"></div>
        <ul class="b3-list">
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.upload}<span class="fn__space"></span><span class="ft__on-surface">${response.data.hTrafficUploadSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.download}<span class="fn__space"></span><span class="ft__on-surface">${response.data.hTrafficDownloadSize}</span></li>
        </ul>
    </div>
</div>`;
        }
        let actionHTML = `<div class="fn__flex">
    <div class="fn__flex-center">${window.siyuan.languages.cloudBackup}</div>
    <span class="b3-list-item__meta fn__flex-center">${response.data.backup?.updated}</span>
    <div class="fn__flex-1"></div>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-type="more">
        <svg><use xlink:href="#iconMore"></use></svg>${window.siyuan.languages.more}
    </button>
</div>    
<div class="fn__none">
    <div class="fn__hr"></div>
    <div style="margin-left: 16px">
        <div class="fn__flex${response.data.backup.size === 0 ? " fn__none" : ""}">
            <span class="fn__flex-center">${window.siyuan.languages.downloadRecover1}</span><span class="fn__space fn__flex-1"></span>
            <button class="b3-button b3-button--outline fn__flex-center fn__size200 fn__flex-shrink" data-type="cloudDownloadRecover"><svg><use xlink:href="#iconUndo"></use></svg>${window.siyuan.languages.downloadRecover}</button>
        </div><div class="fn__hr${response.data.backup.size === 0 ? " fn__none" : ""}"></div>
        <div class="fn__flex">
            <span class="fn__flex-center">${window.siyuan.languages.backupUpload1}</span><span class="fn__space fn__flex-1"></span>
            <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-type="localBackupUpload"><svg><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.backupUpload}</button>
        </div><div class="fn__hr"></div>
        <div class="fn__flex${response.data.backup.size === 0 ? " fn__none" : ""}">
            <span class="fn__flex-center">${window.siyuan.languages.deleteCloudBackup}</span><span class="fn__space fn__flex-1"></span>
            <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-type="cloudRemove"><svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.remove}</button>
        </div>
    </div>
</div>`;
        if (isMobile()) {
            actionHTML = `<div class="fn__flex">
    <div class="fn__flex-center">${window.siyuan.languages.cloudBackup}</div>
    <span class="b3-list-item__meta fn__flex-center">${response.data.backup?.updated}</span>
    <div class="fn__flex-1"></div>
    <button class="b3-button b3-button--outline fn__flex-center" data-type="more">
        <svg><use xlink:href="#iconMore"></use></svg>${window.siyuan.languages.more}
    </button>
</div>
<div class="fn__none">
    <div class="fn__hr"></div>
    <div class="${response.data.backup.size === 0 ? " fn__none" : ""}">
        <button class="b3-button b3-button--outline fn__block" data-type="cloudDownloadRecover"><svg><use xlink:href="#iconUndo"></use></svg>${window.siyuan.languages.downloadRecover}</button>
        <div class="b3-label__text">${window.siyuan.languages.downloadRecover1}</div>
    </div>
    <div class="fn__hr--b${response.data.backup.size === 0 ? " fn__none" : ""}"></div>
    <button class="b3-button b3-button--outline fn__block" data-type="localBackupUpload"><svg><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.backupUpload}</button>
    <div class="b3-label__text">${window.siyuan.languages.backupUpload1}</div>
    <div class="fn__hr--b"></div>
    <div class="${response.data.backup.size === 0 ? " fn__none" : ""}">
        <button class="b3-button b3-button--outline fn__block" data-type="cloudRemove"><svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.remove}</button>
        <div class="b3-label__text">${window.siyuan.languages.deleteCloudBackup}</div>
    </div>
</div>`;
        }
        repos.element.querySelector("#reposBackup").innerHTML = actionHTML;
    });
};

const addCloudName = () => {
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
        fetchPost("/api/sync/createCloudSyncDir", {name: inputElement.value}, () => {
            dialog.destroy();
            getCloudList(true);
        });
    });
};

const setE2eePassword = () => {
    const dialog = new Dialog({
        title: window.siyuan.languages.changeE2EEPasswd,
        content: `<div class="b3-dialog__content">
    <ul class="b3-list b3-list--background">
        <li class="b3-list-item b3-list-item--hide-action" data-type="default">
            <input type="radio" name="mode" class="fn__flex-center">
            <div class="fn__space"></div>
            <span class="b3-list-item__text">${window.siyuan.languages.defaultPassword}</span>
            <span class="b3-list-item__action"><svg class="svg fn__flex-center ft__on-surface"><use xlink:href="#iconRight"></use></svg></span>
        </li>
        <li class="b3-list-item b3-list-item--hide-action" data-type="custom">
            <input type="radio" name="mode" class="fn__flex-center">
            <div class="fn__space"></div>
            <span class="b3-list-item__text">${window.siyuan.languages.customPassword}</span>
            <span class="b3-list-item__action"><svg class="svg fn__flex-center ft__on-surface"><use xlink:href="#iconRight"></use></svg></span>
        </li>
    </ul>
    <div class="fn__none ft__error" data-type="default">
        <button class="b3-button b3-button--outline"><svg><use xlink:href="#iconLeft"></use></svg>${window.siyuan.languages.back}</button>
        <div class="fn__hr"></div>
        ${window.siyuan.languages.defaultPasswordTip}
    </div>
    <div class="fn__none" data-type="custom">
        <button class="b3-button b3-button--outline"><svg><use xlink:href="#iconLeft"></use></svg>${window.siyuan.languages.back}</button>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.customPassword}">
        <div class="fn__hr"></div>
        <div class="b3-label__text ft__error">${window.siyuan.languages.changeE2EEPasswdTip}</div>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "80vw" : "520px",
    });
    dialog.element.querySelector(".b3-dialog__content").addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.classList.contains("b3-dialog__content")) {
            if (target.classList.contains("b3-list-item")) {
                target.parentElement.classList.add("fn__none");
                if (target.getAttribute("data-type") === "default") {
                    target.parentElement.nextElementSibling.classList.remove("fn__none");
                } else {
                    target.parentElement.nextElementSibling.nextElementSibling.classList.remove("fn__none");
                }
                break;
            } else if (target.classList.contains("b3-button--outline")) {
                target.parentElement.classList.add("fn__none");
                dialog.element.querySelector(".b3-list").classList.remove("fn__none");
                break;
            }
            target = target.parentElement;
        }
    });
    const btnsElement = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
    inputElement.addEventListener("keydown", (event) => {
        if (event.isComposing) {
            event.preventDefault();
            return;
        }
        if (event.key === "Enter") {
            (btnsElement[1] as HTMLButtonElement).click();
            event.preventDefault();
            event.stopPropagation();
        } else if (event.key === "Escape") {
            dialog.destroy();
            event.stopPropagation();
            event.preventDefault();
        }
    });
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        if (!dialog.element.querySelector(".b3-list").classList.contains("fn__none")) {
            showMessage(window.siyuan.languages.plsChoose);
            return;
        }
        const mode = dialog.element.querySelector('div[data-type="default"]').classList.contains("fn__none") ? 1 : 0;
        fetchPost("/api/system/setE2EEPasswd", {
            e2eePasswd: inputElement.value,
            mode    //0：内置密码; 1：自定义密码
        }, () => {
            window.siyuan.config.e2eePasswdMode = mode;
            dialog.destroy();
            const updateElement = repos.element.querySelector("#updatePassword").parentElement;
            updateElement.classList.add("fn__none");
            if (0 === window.siyuan.config.e2eePasswdMode) {
                updateElement.nextElementSibling.lastElementChild.innerHTML = window.siyuan.languages.builtinE2EEPasswdTip;
            } else {
                updateElement.nextElementSibling.lastElementChild.innerHTML = window.siyuan.languages.changeE2EEPasswdTip;
            }
            updateElement.nextElementSibling.classList.remove("fn__none");
            window.siyuan.config.e2eePasswd = "******";
        });
    });
};

const needPassword = () => {
    if (window.siyuan.config.e2eePasswd === "" && !window.siyuan.config.sync.useDataRepo) {
        confirmDialog(window.siyuan.languages.config, window.siyuan.languages._kernel[11]);
        return true;
    }
    return false;
};

export const repos = {
    element: undefined as Element,
    genHTML: () => {
        if (needSubscribe("")) {
            return `<div class="b3-label">${window.siyuan.config.system.container === "ios" ? window.siyuan.languages._kernel[122] : window.siyuan.languages._kernel[29]}</div>
<div class="b3-label">
    ${window.siyuan.languages.cloudIntro1}
    <div class="b3-label__text b3-typography">
        <ul>
            <li>${window.siyuan.languages.cloudIntro2}</li>
            <li>${window.siyuan.languages.cloudIntro3}</li>
            <li>${window.siyuan.languages.cloudIntro4}</li>
            <li>${window.siyuan.languages.cloudIntro5}</li>
            <li>${window.siyuan.languages.cloudIntro6}</li>
            <li>${window.siyuan.languages.cloudIntro7}</li>
            <li>${window.siyuan.languages.cloudIntro8}</li>
        </ul>
    </div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.cloudIntro9}
    <div class="b3-label__text b3-typography">
        <ul>
            <li>${window.siyuan.languages.cloudIntro10}</li>
            <li>${window.siyuan.languages.cloudIntro11}</li>
        </ul>
    </div>
</div>`;
        }
        let passwordHTML = `<div class="b3-label fn__flex${(window.siyuan.config.e2eePasswd !== "" || window.siyuan.config.sync.useDataRepo) ? " fn__none" : ""}">
    <div class="fn__flex-1 fn__flex-center">
        ${window.siyuan.languages.e2eePasswd}
        <div class="b3-label__text ft__error">${window.siyuan.languages.e2eePasswdTip}</div>
    </div>
    <div class="fn__space"></div>
    <button id="updatePassword" class="b3-button b3-button--outline fn__size200 fn__flex-center">
        <svg><use xlink:href="#iconLock"></use></svg>
        ${window.siyuan.languages.setPasswd}
    </button>
</div>
<div class="b3-label${(window.siyuan.config.e2eePasswd === "" || window.siyuan.config.sync.useDataRepo) ? " fn__none" : ""}">
    ${window.siyuan.languages.e2eePasswd}
    <div class="b3-label__text"><i>${window.siyuan.languages.passwdSet}</i></div>
    <div class="b3-label__text ft__error">${0 === window.siyuan.config.e2eePasswdMode ? window.siyuan.languages.builtinE2EEPasswdTip : window.siyuan.languages.changeE2EEPasswdTip}</div>
</div>`;
        if (isMobile()) {
            passwordHTML = `<div class="b3-label${(window.siyuan.config.e2eePasswd !== "" || window.siyuan.config.sync.useDataRepo) ? " fn__none" : ""}">
    ${window.siyuan.languages.e2eePasswd}
    <div class="fn__hr"></div>
    <button id="updatePassword" class="b3-button b3-button--outline fn__block">
        <svg><use xlink:href="#iconLock"></use></svg>
        ${window.siyuan.languages.setPasswd}
    </button>
    <div class="b3-label__text ft__error">${window.siyuan.languages.e2eePasswdTip}</div>
</div>
<div class="b3-label${(window.siyuan.config.e2eePasswd === "" || window.siyuan.config.sync.useDataRepo) ? " fn__none" : ""}">
    ${window.siyuan.languages.e2eePasswd}
    <div class="fn__hr"></div>
    <div class="b3-label__text"><i>${window.siyuan.languages.passwdSet}</i></div>
    <div class="b3-label__text ft__error">${0 === window.siyuan.config.e2eePasswdMode ? window.siyuan.languages.builtinE2EEPasswdTip : window.siyuan.languages.changeE2EEPasswdTip}</div>
</div>`;
        }
        return `<div><div style="position: fixed;width: 800px;height: 434px;box-sizing: border-box;text-align: center;display: flex;align-items: center;justify-content: center;z-index: 1;" id="reposLoading">
    <img src="/stage/loading-pure.svg">
</div>
<div id="reposData" class="b3-label">
    <div class="fn__flex">
        <div class="fn__flex-1">
            ${window.siyuan.languages.cloudStorage}
        </div>
        <div class="fn__flex-1">
            ${window.siyuan.languages.trafficStat}
        </div>
    </div>
</div>
${passwordHTML}
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.openSyncTip1}
        <div class="b3-label__text">${window.siyuan.languages.openSyncTip2}</div>
    </div>
    <span class="fn__space"></span>
    <input type="checkbox" id="reposCloudSyncSwitch"${window.siyuan.config.sync.enabled ? " checked='checked'" : ""} class="b3-switch fn__flex-center">
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.syncMode}
        <div class="b3-label__text">${window.siyuan.languages.syncModeTip}</div>
    </div>
    <span class="fn__space"></span>
    <select id="syncMode" class="b3-select fn__flex-center fn__size200">
        <option value="1" ${window.siyuan.config.sync.mode === 1 ? "selected" : ""}>${window.siyuan.languages.syncMode1}</option>
        <option value="2" ${window.siyuan.config.sync.mode === 2 ? "selected" : ""}>${window.siyuan.languages.syncMode2}</option>
    </select>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.syncDataRepo}
        <div class="b3-label__text">${window.siyuan.languages.syncDataRepoTip}</div>
    </div>
    <span class="fn__space"></span>
    <input type="checkbox" id="useDataRepo"${window.siyuan.config.sync.useDataRepo ? " checked='checked'" : ""} class="b3-switch fn__flex-center">
</label>
<div class="b3-label">
    <div class="fn__flex">
        <div class="fn__flex-center">${window.siyuan.languages.cloudSync}</div>
        <div class="fn__flex-1"></div>
        <button class="b3-button b3-button--outline fn__flex-center${isMobile() ? "" : " fn__size200"}" data-type="config">
            <svg><use xlink:href="#iconSettings"></use></svg>${window.siyuan.languages.config}
        </button>
    </div>
    <div id="reposCloudSyncList" class="fn__none config-repos__sync"><img style="margin: 0 auto;display: block;" src="/stage/loading-pure.svg"></div>
</div>
<div id="reposBackup" class="b3-label${window.siyuan.config.sync.useDataRepo ? " fn__none" : ""}">${window.siyuan.languages.cloudBackup}</div>
<div class="b3-label fn__flex${window.siyuan.config.sync.useDataRepo ? "" : " fn__none"}">
    <div class="fn__flex-center">${window.siyuan.languages.cloudBackup}</div>
    <div class="b3-list-item__meta fn__flex-center">${window.siyuan.languages.cloudBackupTip}</div>
</div>
</div>`;
    },
    bindEvent: () => {
        if (needSubscribe("")) {
            return;
        }
        renderCloudBackup();
        repos.element.querySelector("#updatePassword").addEventListener("click", () => {
            setE2eePassword();
        });
        const switchElement = repos.element.querySelector("#reposCloudSyncSwitch") as HTMLInputElement;
        switchElement.addEventListener("change", () => {
            if (switchElement.checked && window.siyuan.config.sync.cloudName === "") {
                switchElement.checked = false;
                showMessage(window.siyuan.languages._kernel[123]);
                return;
            }
            fetchPost("/api/sync/setSyncEnable", {enabled: switchElement.checked}, (response) => {
                if (response.code === 1) {
                    showMessage(response.msg);
                    switchElement.checked = false;
                } else {
                    window.siyuan.config.sync.enabled = switchElement.checked;
                }
            });
        });
        const syncModeElement = repos.element.querySelector("#syncMode") as HTMLSelectElement;
        syncModeElement.addEventListener("change", () => {
            fetchPost("/api/sync/setSyncMode", {mode: parseInt(syncModeElement.value, 10)}, (response) => {
                if (response.code === 1) {
                    showMessage(response.msg);
                    syncModeElement.value = "1";
                } else {
                    window.siyuan.config.sync.mode = parseInt(syncModeElement.value, 10);
                }
            });
        });
        const useDataRepoElement = repos.element.querySelector("#useDataRepo") as HTMLInputElement;
        useDataRepoElement.addEventListener("change", () => {
            fetchPost("/api/sync/setSyncUseDataRepo", {enabled: useDataRepoElement.checked}, (response) => {
                if (response.code === 1) {
                    showMessage(response.msg);
                    useDataRepoElement.checked = false;
                } else {
                    window.siyuan.config.sync.useDataRepo = useDataRepoElement.checked;
                    const reposBackupElement = repos.element.querySelector("#reposBackup") as HTMLElement;
                    const reposPasswordElement = repos.element.querySelector("#updatePassword").parentElement as HTMLElement;
                    if (useDataRepoElement.checked) {
                        reposBackupElement.classList.add("fn__none");
                        reposBackupElement.nextElementSibling.classList.remove("fn__none");
                        if (window.siyuan.config.e2eePasswd === "") {
                            reposPasswordElement.classList.add("fn__none");
                        } else {
                            reposPasswordElement.nextElementSibling.classList.add("fn__none");
                        }
                    } else {
                        reposBackupElement.classList.remove("fn__none");
                        reposBackupElement.nextElementSibling.classList.add("fn__none");
                        if (window.siyuan.config.e2eePasswd === "") {
                            reposPasswordElement.classList.remove("fn__none");
                        } else {
                            reposPasswordElement.nextElementSibling.classList.remove("fn__none");
                        }
                    }
                }
            });
        });
        const loadingElement = repos.element.querySelector("#reposLoading") as HTMLElement;
        loadingElement.style.width = repos.element.clientWidth + "px";
        loadingElement.style.height = repos.element.clientHeight + "px";
        repos.element.firstElementChild.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            const syncConfigElement = repos.element.querySelector("#reposCloudSyncList");
            while (target && !target.isEqualNode(repos.element.firstElementChild)) {
                const type = target.getAttribute("data-type");
                if (type) {
                    switch (type) {
                        case "more":
                            repos.element.querySelector("#reposBackup").lastElementChild.classList.toggle("fn__none");
                            break;
                        case "config":
                            if (!needPassword()) {
                                if (syncConfigElement.classList.contains("fn__none")) {
                                    getCloudList();
                                    syncConfigElement.classList.remove("fn__none");
                                } else {
                                    syncConfigElement.classList.add("fn__none");
                                }
                            }
                            break;
                        case "cloudDownloadRecover":
                            if (!needPassword()) {
                                confirmDialog(window.siyuan.languages.downloadCloud, window.siyuan.languages.downloadCloudTip, () => {
                                    fetchPost("/api/backup/downloadCloudBackup", {}, () => {
                                        fetchPost("/api/backup/recoverLocalBackup", {}, () => {
                                            setTimeout(() => {
                                                /// #if !MOBILE
                                                exportLayout(false, () => {
                                                    exitSiYuan();
                                                });
                                                /// #else
                                                window.location.reload();
                                                /// #endif
                                            }, 7000);
                                            return;
                                        });
                                    });
                                });
                            }
                            break;
                        case "cloudRemove":
                            if (!needPassword()) {
                                confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.confirmDelete + "?", () => {
                                    fetchPost("/api/backup/removeCloudBackup", {}, () => {
                                        renderCloudBackup();
                                    });
                                });
                            }
                            break;
                        case "localBackupUpload":
                            if (!needPassword()) {
                                confirmDialog(window.siyuan.languages.backupUpload, window.siyuan.languages.account3Tip, () => {
                                    fetchPost("/api/backup/createLocalBackup", {}, () => {
                                        fetchPost("/api/backup/uploadLocalBackup", {}, () => {
                                            renderCloudBackup();
                                        });
                                    });
                                });
                            }
                            break;
                        case "addCloud":
                            addCloudName();
                            break;
                        case "removeCloud":
                            confirmDialog(window.siyuan.languages.confirm, `${window.siyuan.languages.confirmDeleteCloudDir} <i>${target.parentElement.getAttribute("data-name")}</i>`, () => {
                                fetchPost("/api/sync/removeCloudSyncDir", {name: target.parentElement.getAttribute("data-name")}, (response) => {
                                    window.siyuan.config.sync.cloudName = response.data;
                                    getCloudList(true);
                                });
                            });
                            break;
                        case "selectCloud":
                            if (target.parentElement.getAttribute("disabled") !== "disabled") {
                                target.parentElement.setAttribute("disabled", "disabled");
                                fetchPost("/api/sync/getSyncDirection", {name: target.getAttribute("data-name")}, (response) => {
                                    target.parentElement.removeAttribute("disabled");
                                    const name = target.getAttribute("data-name");
                                    if (40 == response.code) { // 使用数据仓库同步不需要对比同步方向
                                        fetchPost("/api/sync/setCloudSyncDir", {name}, () => {
                                            window.siyuan.config.sync.cloudName = name;
                                            getCloudList(true);
                                        });
                                        return;
                                    }

                                    confirmDialog(window.siyuan.languages.confirm, response.msg, () => {
                                        fetchPost("/api/sync/setCloudSyncDir", {name}, () => {
                                            window.siyuan.config.sync.cloudName = name;
                                            getCloudList(true);
                                        });
                                    });
                                });
                            }
                            break;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });
    },
};
