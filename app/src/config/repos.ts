import {confirmDialog} from "../dialog/confirmDialog";
import {needSubscribe} from "../util/needSubscribe";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {Dialog} from "../dialog";
import {showMessage} from "../dialog/message";

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
<div class="b3-label">
    <div class="fn__flex">
        <div class="fn__flex-center">${window.siyuan.languages.cloudSyncDir}</div>
        <div class="fn__flex-1"></div>
        <button class="b3-button b3-button--outline fn__flex-center${isMobile() ? "" : " fn__size200"}" data-type="config">
            <svg><use xlink:href="#iconSettings"></use></svg>${window.siyuan.languages.config}
        </button>
    </div>
    <div id="reposCloudSyncList" class="fn__none config-repos__sync"><img style="margin: 0 auto;display: block;" src="/stage/loading-pure.svg"></div>
</div>
<div class="b3-label fn__flex">
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
                        case "config":
                            if (syncConfigElement.classList.contains("fn__none")) {
                                getCloudList();
                                syncConfigElement.classList.remove("fn__none");
                            } else {
                                syncConfigElement.classList.add("fn__none");
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
                            fetchPost("/api/sync/setCloudSyncDir", {name: target.getAttribute("data-name")}, () => {
                                window.siyuan.config.sync.cloudName = target.getAttribute("data-name");
                                getCloudList(true);
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
    },
};
