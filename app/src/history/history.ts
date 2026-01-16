import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {Constants} from "../constants";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {renderAssetsPreview} from "../asset/renderAssets";
import {Protyle} from "../protyle";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import * as dayjs from "dayjs";
import {fetchPost} from "../util/fetch";
import {escapeAttr, escapeHtml} from "../util/escape";
import {isMobile} from "../util/functions";
import {showDiff} from "./diff";
import {setStorageVal} from "../protyle/util/compatibility";
import {openModel} from "../mobile/menu/model";
import {closeModel} from "../mobile/util/closePanel";
import {App} from "../index";
import {resizeSide} from "./resizeSide";
import {isSupportCSSHL, searchMarkRender} from "../protyle/render/searchMarkRender";

let historyEditor: Protyle;

const renderDoc = (element: HTMLElement, currentPage: number) => {
    const previousElement = element.querySelector('[data-type="docprevious"]');
    const nextElement = element.querySelector('[data-type="docnext"]');
    element.setAttribute("data-page", currentPage.toString());
    if (currentPage > 1) {
        previousElement.removeAttribute("disabled");
    } else {
        previousElement.setAttribute("disabled", "disabled");
    }
    const pageBtn = element.querySelector('button[data-type="jumpHistoryPage"]');
    pageBtn.textContent = `${currentPage}`;

    const inputElement = element.querySelector(".b3-text-field") as HTMLInputElement;
    const opElement = element.querySelector('.b3-select[data-type="opselect"]') as HTMLSelectElement;
    const typeElement = element.querySelector('.b3-select[data-type="typeselect"]') as HTMLSelectElement;
    const notebookElement = element.querySelector('.b3-select[data-type="notebookselect"]') as HTMLSelectElement;
    const docElement = element.querySelector('.history__text[data-type="docPanel"]');
    const assetElement = element.querySelector('.history__text[data-type="assetPanel"]');
    const mdElement = element.querySelector('.history__text[data-type="mdPanel"]') as HTMLTextAreaElement;
    const listElement = element.querySelector(".b3-list");
    element.querySelector(".protyle-title__input").classList.add("fn__none");
    assetElement.classList.add("fn__none");
    mdElement.classList.add("fn__none");
    docElement.classList.add("fn__none");
    if (typeElement.value === "2") {
        notebookElement.setAttribute("disabled", "disabled");
        if (window.siyuan.storage[Constants.LOCAL_HISTORY].type !== 2) {
            opElement.value = "all";
        }
        opElement.querySelector('option[value="clean"]').classList.remove("fn__none");
        opElement.querySelector('option[value="update"]').classList.remove("fn__none");
        opElement.querySelector('option[value="delete"]').classList.add("fn__none");
        opElement.querySelector('option[value="format"]').classList.add("fn__none");
        opElement.querySelector('option[value="sync"]').classList.remove("fn__none");
        opElement.querySelector('option[value="replace"]').classList.add("fn__none");
        opElement.querySelector('option[value="outline"]').classList.add("fn__none");
    } else {
        notebookElement.removeAttribute("disabled");
        if (window.siyuan.storage[Constants.LOCAL_HISTORY].type === 2) {
            opElement.value = "all";
        }
        opElement.querySelector('option[value="clean"]').classList.add("fn__none");
        opElement.querySelector('option[value="update"]').classList.remove("fn__none");
        opElement.querySelector('option[value="delete"]').classList.remove("fn__none");
        opElement.querySelector('option[value="format"]').classList.remove("fn__none");
        opElement.querySelector('option[value="sync"]').classList.remove("fn__none");
        opElement.querySelector('option[value="replace"]').classList.remove("fn__none");
        opElement.querySelector('option[value="outline"]').classList.remove("fn__none");
    }
    window.siyuan.storage[Constants.LOCAL_HISTORY].notebookId = notebookElement.value;
    window.siyuan.storage[Constants.LOCAL_HISTORY].type = parseInt(typeElement.value);
    window.siyuan.storage[Constants.LOCAL_HISTORY].operation = opElement.value;
    setStorageVal(Constants.LOCAL_HISTORY, window.siyuan.storage[Constants.LOCAL_HISTORY]);
    fetchPost("/api/history/searchHistory", {
        notebook: notebookElement.value,
        query: inputElement.value,
        page: currentPage,
        op: opElement.value,
        type: parseInt(typeElement.value)
    }, (response) => {
        if (currentPage < response.data.pageCount) {
            nextElement.removeAttribute("disabled");
        } else {
            nextElement.setAttribute("disabled", "disabled");
        }
        pageBtn.setAttribute("data-totalpage", (response.data.pageCount || 1).toString());
        const pageElement = nextElement.nextElementSibling.nextElementSibling;
        pageElement.textContent = `${window.siyuan.languages.pageCountAndHistoryCount.replace("${x}", response.data.pageCount).replace("${y}", response.data.totalCount || 1)}`;
        pageElement.classList.remove("fn__none");
        if (response.data.histories.length === 0) {
            listElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
            return;
        }
        let logsHTML = "";
        response.data.histories.forEach((item: string) => {
            logsHTML += `<li class="b3-list-item" data-type="toggle" data-created="${item}">
    <span class="b3-list-item__toggle b3-list-item__toggle--hl"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span>
    <span style="padding-left: 4px" class="b3-list-item__text">${dayjs(parseInt(item) * 1000).format("YYYY-MM-DD HH:mm:ss")}</span>
</li>`;
        });
        listElement.innerHTML = logsHTML;
    });
};

const renderRepoItem = (response: IWebSocketData, element: Element, type: string) => {
    if (response.data.snapshots.length === 0) {
        element.lastElementChild.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
        return;
    }
    let actionHTML = "";
    /// #if MOBILE
    if (type === "getCloudRepoTagSnapshots") {
        actionHTML = `<span class="fn__flex-1"></span>
<span class="b3-list-item__action" data-type="downloadSnapshot">
    <svg><use xlink:href="#iconDownload"></use></svg>
    <span class="fn__space"></span>
    ${window.siyuan.languages.download}
</span>
<span class="fn__flex-1"></span>
<span class="b3-list-item__action" data-type="downloadRollback">
    <svg><use xlink:href="#iconUndo"></use></svg>
    <span class="fn__space"></span>
    ${window.siyuan.languages.downloadRollback}
</span>
<span class="fn__flex-1"></span>
<span class="b3-list-item__action" data-type="removeCloudRepoTagSnapshot">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
    <span class="fn__space"></span>
    ${window.siyuan.languages.remove}
</span>
<span class="fn__flex-1"></span>`;
    } else if (type === "getCloudRepoSnapshots") {
        actionHTML = `<span class="fn__flex-1"></span>
<span class="b3-list-item__action" data-type="downloadSnapshot">
    <svg><use xlink:href="#iconDownload"></use></svg>
    <span class="fn__space"></span>
    ${window.siyuan.languages.download}
</span>
<span class="fn__flex-1"></span>
<span class="b3-list-item__action" data-type="downloadRollback">
    <svg><use xlink:href="#iconUndo"></use></svg>
    <span class="fn__space"></span>
    ${window.siyuan.languages.downloadRollback}
</span>
<span class="fn__flex-1"></span>`;
    } else if (type === "getRepoTagSnapshots") {
        actionHTML = `<span class="fn__flex-1"></span>
<span class="b3-list-item__action" data-type="uploadSnapshot">
    <svg><use xlink:href="#iconUpload"></use></svg>
    <span class="fn__space"></span>
    ${window.siyuan.languages.upload}
</span>
<span class="fn__flex-1"></span>
<span class="b3-list-item__action" data-type="rollback">
    <svg><use xlink:href="#iconUndo"></use></svg>
    <span class="fn__space"></span>
    ${window.siyuan.languages.rollback}
</span>
<span class="fn__flex-1"></span>
<span class="b3-list-item__action" data-type="removeRepoTagSnapshot">
    <svg><use xlink:href="#iconTrashcan"></use></svg>
    <span class="fn__space"></span>
    ${window.siyuan.languages.remove}
</span>
<span class="fn__flex-1"></span>`;
    } else if (type === "getRepoSnapshots") {
        actionHTML = `<span class="fn__flex-1"></span>
<span class="b3-list-item__action" data-type="genTag">
    <svg><use xlink:href="#iconTags"></use></svg>
    <span class="fn__space"></span>
    ${window.siyuan.languages.tagSnapshot}
</span>
<span class="fn__flex-1"></span>
<span class="b3-list-item__action" data-type="rollback">
    <svg><use xlink:href="#iconUndo"></use></svg>
    <span class="fn__space"></span>
    ${window.siyuan.languages.rollback}
</span>
<span class="fn__flex-1"></span>`;
    }
    /// #else
    if (type === "getCloudRepoTagSnapshots") {
        actionHTML = `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="downloadSnapshot" aria-label="${window.siyuan.languages.download}"><svg><use xlink:href="#iconDownload"></use></svg></span>
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="downloadRollback" aria-label="${window.siyuan.languages.downloadRollback}"><svg><use xlink:href="#iconUndo"></use></svg></span>
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="removeCloudRepoTagSnapshot" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>`;
    } else if (type === "getCloudRepoSnapshots") {
        actionHTML = `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="downloadSnapshot" aria-label="${window.siyuan.languages.download}"><svg><use xlink:href="#iconDownload"></use></svg></span>
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="downloadRollback" aria-label="${window.siyuan.languages.downloadRollback}"><svg><use xlink:href="#iconUndo"></use></svg></span>`;
    } else if (type === "getRepoTagSnapshots") {
        actionHTML = `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="uploadSnapshot" aria-label="${window.siyuan.languages.upload}"><svg><use xlink:href="#iconUpload"></use></svg></span>
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}"><svg><use xlink:href="#iconUndo"></use></svg></span>
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="removeRepoTagSnapshot" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>`;
    } else if (type === "getRepoSnapshots") {
        actionHTML = `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="genTag" aria-label="${window.siyuan.languages.tagSnapshot}"><svg><use xlink:href="#iconTags"></use></svg></span>
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}"><svg><use xlink:href="#iconUndo"></use></svg></span>`;
    }
    /// #endif
    let repoHTML = "";
    const isPhone = isMobile();
    const selectId: { id: string, time: string }[] = ["getRepoTagSnapshots", "getRepoSnapshots"].includes(type) ?
        JSON.parse(element.querySelector(".b3-button[data-type='compare']").getAttribute("data-ids") || "[]") : [];
    response.data.snapshots.forEach((item: {
        memo: string,
        id: string,
        hCreated: string,
        count: number,
        hSize: string,
        systemID: string,
        systemName: string,
        systemOS: string,
        tag: string,
        typesCount: { type: string, count: number }[]
    }) => {
        let statHTML = "";
        if (item.typesCount) {
            statHTML = `<div class="b3-list-item__meta${isPhone ? " fn__none" : ""}">
${window.siyuan.languages.fileCount} ${item.count}<span class="fn__space"></span>`;
            item.typesCount.forEach(subItem => {
                statHTML += `${subItem.type} ${subItem.count}<span class="fn__space"></span>`;
            });
            statHTML += "</div>";
        }
        const infoHTML = `<div${isPhone ? ' style="padding-top:8px"' : ""}>
    <span data-type="hCreated">${item.hCreated}</span>
    <span class="fn__space"></span>
    ${item.hSize}
    <span class="fn__space"></span>
    ${item.systemOS}${(item.systemName && item.systemOS) ? "/" : ""}${item.systemName}
    <span class="fn__space"></span>
    <span class="b3-chip b3-chip--secondary b3-chip--small${item.tag ? "" : " fn__none"}">${item.tag}</span>
</div>
<div class="b3-list-item__meta${isPhone ? " fn__none" : ""}">
    ${escapeHtml(item.memo)}
    <span class="fn__space"></span>
    <code class="fn__code">${item.id.substring(0, 7)}</code>
</div>
${statHTML}`;
        const hasSelected = selectId.find(subItem => subItem.id === item.id);
        /// #if MOBILE
        repoHTML += `<li class="b3-list-item${hasSelected ? " b3-list-item--focus" : ""}" data-type="repoitem" data-id="${item.id}" data-tag="${item.tag}">
<div class="fn__flex-1">
    ${infoHTML}
    <div class="fn__flex" style="height: 26px" data-type="repoitem"" data-id="${item.id}" data-tag="${item.tag}">
        ${actionHTML}
        <span class="b3-list-item__action" data-type="more">
            <svg><use xlink:href="#iconMore"></use></svg>
            <span class="fn__space"></span>
            ${window.siyuan.languages.more}
        </span>
        <span class="fn__flex-1"></span>
    </div>
</div>
</li>`;
        /// #else
        repoHTML += `<li class="b3-list-item b3-list-item--hide-action${hasSelected ? " b3-list-item--focus" : ""}" data-type="repoitem" data-id="${item.id}" data-tag="${item.tag}">
<div class="fn__flex-1">${infoHTML}</div>
${actionHTML}
</li>`;
        /// #endif
    });
    element.lastElementChild.innerHTML = `${repoHTML}`;
};

const renderRepo = (element: Element, currentPage: number) => {
    const selectElement = element.querySelector(".b3-select") as HTMLSelectElement;
    selectElement.disabled = true;
    const selectValue = selectElement.value;
    element.lastElementChild.innerHTML = '<li style="position: relative;height: 100%;"><div class="fn__loading"><img width="64px" src="/stage/loading-pure.svg"></div></li>';
    const pageBtn = element.querySelector('button[data-type="jumpRepoPage"]');
    pageBtn.textContent = `${currentPage}`;

    const previousElement = element.querySelector('[data-type="previous"]');
    const nextElement = element.querySelector('[data-type="next"]');
    const pageElement = nextElement.nextElementSibling.nextElementSibling;
    element.setAttribute("data-init", "true");
    if (selectValue === "getRepoTagSnapshots" || selectValue === "getCloudRepoTagSnapshots") {
        fetchPost(`/api/repo/${selectValue}`, {}, (response) => {
            renderRepoItem(response, element, selectValue);
            selectElement.disabled = false;
        });
        previousElement.classList.add("fn__none");
        nextElement.classList.add("fn__none");
        pageElement.classList.add("fn__none");
        pageBtn.classList.add("fn__none");
    } else {
        previousElement.classList.remove("fn__none");
        nextElement.classList.remove("fn__none");
        pageBtn.classList.remove("fn__none");
        element.setAttribute("data-page", currentPage.toString());
        if (currentPage > 1) {
            previousElement.removeAttribute("disabled");
        } else {
            previousElement.setAttribute("disabled", "disabled");
        }
        nextElement.setAttribute("disabled", "disabled");
        fetchPost(`/api/repo/${selectValue}`, {page: currentPage}, (response) => {
            selectElement.disabled = false;
            if (currentPage < response.data.pageCount) {
                nextElement.removeAttribute("disabled");
            } else {
                nextElement.setAttribute("disabled", "disabled");
            }
            pageBtn.setAttribute("data-totalpage", (response.data.pageCount || 1).toString());
            pageElement.textContent = `${window.siyuan.languages.pageCountAndSnapshotCount.replace("${x}", response.data.pageCount).replace("${y}", response.data.totalCount || 1)}`;
            pageElement.classList.remove("fn__none");
            renderRepoItem(response, element, selectValue);
        });
    }
};

const renderRmNotebook = (element: HTMLElement) => {
    element.setAttribute("data-init", "true");
    fetchPost("/api/history/getNotebookHistory", {}, (response) => {
        if (response.data.histories.length === 0) {
            element.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
            return;
        }
        let logsHTML = "";
        response.data.histories.forEach((item: {
            items: { path: string, title: string }[],
            hCreated: string
        }, index: number) => {
            logsHTML += `<li class="b3-list-item" style="padding-left: 0" data-type="rmtoggle">
    <span style="padding-left: 8px" class="b3-list-item__toggle"><svg class="b3-list-item__arrow${index === 0 ? " b3-list-item__arrow--open" : ""}${item.items.length > 0 ? "" : " fn__hidden"}"><use xlink:href="#iconRight"></use></svg></span>
    <span class="b3-list-item__text">${item.hCreated}</span>
</li>`;
            if (item.items.length > 0) {
                logsHTML += `<ul class="${index === 0 ? "" : "fn__none"}">`;
                item.items.forEach((docItem) => {
                    logsHTML += `<li data-type="notebook" data-path="${docItem.path}" class="b3-list-item b3-list-item--hide-action" style="padding-left: 32px">
    <span class="b3-list-item__text">${escapeHtml(docItem.title)}</span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
</li>`;
                });
                logsHTML += "</ul>";
            }
        });
        element.innerHTML = logsHTML;
    });
};

export const openHistory = (app: App) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item.element.querySelector("#historyContainer")) {
            item.destroy();
            return true;
        }
    });
    if (exitDialog) {
        return;
    }

    const localHistory = window.siyuan.storage[Constants.LOCAL_HISTORY];
    let notebookSelectHTML = `<option value='%' ${localHistory.notebookId === "%" ? "selected" : ""}>${window.siyuan.languages.allNotebooks}</option>`;
    window.siyuan.notebooks.forEach((item) => {
        if (!item.closed) {
            notebookSelectHTML += ` <option value="${item.id}"${item.id === localHistory.notebookId ? " selected" : ""}>${escapeHtml(item.name)}</option>`;
        }
    });

    const contentHTML = `<div class="fn__flex-column" style="height: 100%;">
    <div class="layout-tab-bar fn__flex" ${isMobile() ? "" : 'style="border-radius: var(--b3-border-radius-b) var(--b3-border-radius-b) 0 0"'}>
        <div data-type="doc" class="item item--full item--focus"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.fileHistory}</span><span class="fn__flex-1"></span></div>
        <div data-type="notebook" style="min-width: 160px" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.removedNotebook}</span><span class="fn__flex-1"></span></div>
        <div data-type="repo" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.dataSnapshot}</span><span class="fn__flex-1"></span></div>
    </div>
    <div class="fn__flex-1 fn__flex" id="historyContainer">
        <div data-type="doc" class="history__repo fn__block" data-init="true">
            <div class="history__action">
                <div class="block__icons">
                    <span data-type="docprevious" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
                    <button class="b3-button b3-button--text ft__selectnone" data-type="jumpHistoryPage" data-totalpage="1">1</button>
                    <span data-type="docnext" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
                    <span class="fn__space"></span>
                    <span class="ft__on-surface fn__flex-shrink ft__selectnone fn__none">${window.siyuan.languages.pageCountAndHistoryCount}</span>
                    <span class="fn__space"></span>
                    <div class="fn__flex-1"></div>
                    <div style="position: relative">
                        <svg class="b3-form__icon-icon ft__on-surface"><use xlink:href="#iconSearch"></use></svg>
                        <input class="b3-text-field b3-form__icon-input ${isMobile() ? "fn__size96" : "fn__size200"}">
                    </div>
                    <span class="fn__space"></span>
                    <select data-type="typeselect" class="b3-select ${isMobile() ? "fn__size96" : "fn__size200"}">
                        <option value="0" ${localHistory.type === 0 ? "selected" : ""}>${window.siyuan.languages.docName}</option>
                        <option value="1" ${localHistory.type === 1 ? "selected" : ""}>${window.siyuan.languages.docNameAndContent}</option>
                        <option value="2" ${localHistory.type === 2 ? "selected" : ""}>${window.siyuan.languages.assets}</option>
                    </select>
                    <span class="fn__space"></span>
                    <select data-type="opselect" class="b3-select${isMobile() ? " fn__size96" : ""}">
                        <option value="all" ${localHistory.operation === "all" ? "selected" : ""}>${window.siyuan.languages.allOp}</option>
                        <option value="clean" ${localHistory.operation === "clean" ? "selected" : ""}>${window.siyuan.languages.historyClean}</option>
                        <option value="update" ${localHistory.operation === "update" ? "selected" : ""}>${window.siyuan.languages.historyUpdate}</option>
                        <option value="delete" ${localHistory.operation === "delete" ? "selected" : ""}>${window.siyuan.languages.historyDelete}</option>
                        <option value="format" ${localHistory.operation === "format" ? "selected" : ""}>${window.siyuan.languages.historyFormat}</option>
                        <option value="sync" ${localHistory.operation === "sync" ? "selected" : ""}>${window.siyuan.languages.historySync}</option>
                        <option value="replace" ${localHistory.operation === "replace" ? "selected" : ""}>${window.siyuan.languages.historyReplace}</option>
                        <option value="outline" ${localHistory.operation === "outline" ? "selected" : ""}>${window.siyuan.languages.historyOutline}</option>
                    </select>
                    <span class="fn__space"></span>
                    <select data-type="notebookselect" class="b3-select ${isMobile() ? "fn__size96" : "fn__size200"}">
                        ${notebookSelectHTML}
                    </select>
                    <span class="fn__space"></span>
                    <button data-type="rebuildIndex" class="b3-button b3-button--outline">${window.siyuan.languages.rebuildIndex}</button>
                </div>
            </div>
            <div class="fn__flex fn__flex-1 history__panel">
                <ul class="b3-list b3-list--background history__side" ${isMobile() ? "" : `style="width: ${localHistory.sideWidth}"`}>
                    <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
                </ul>
                <div class="history__resize"></div>
                <div class="fn__flex-column fn__flex-1">
                    <div class="protyle-title__input ft__center ft__breakword fn__none"></div>
                    <div class="fn__flex-1 history__text fn__none" data-type="assetPanel"></div>
                    <textarea class="fn__flex-1 history__text fn__none" data-type="mdPanel"></textarea>
                    <div class="fn__flex-1 history__text fn__none" style="padding: 0" data-type="docPanel"></div>
                </div>
            </div>
        </div>
        <ul data-type="notebook" style="padding: 8px 0;" class="fn__none b3-list b3-list--background">
            <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
        </ul>
        <div data-type="repo" class="fn__none history__repo">
            <div class="history__action">
                <div class="block__icons">
                    <span data-type="previous" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
                    <button class="b3-button b3-button--text ft__selectnone" data-type="jumpRepoPage" data-totalpage="1">1</button>
                    <span data-type="next" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
                    <span class="fn__space"></span>
                    <span class="ft__on-surface fn__flex-shrink ft__selectnone fn__none">${window.siyuan.languages.pageCountAndSnapshotCount}</span>
                    <span class="fn__space"></span>
                    <div class="fn__flex-1"></div>
                    <select class="b3-select ${isMobile() ? "fn__size96" : "fn__size200"}">
                        <option value="getRepoSnapshots">${window.siyuan.languages.localSnapshot}</option>
                        <option value="getRepoTagSnapshots">${window.siyuan.languages.localTagSnapshot}</option>
                        <option value="getCloudRepoSnapshots">${window.siyuan.languages.cloudSnapshot}</option>
                        <option value="getCloudRepoTagSnapshots">${window.siyuan.languages.cloudTagSnapshot}</option>
                    </select>
                    <span class="fn__space"></span>
                    <button class="b3-button b3-button--outline" disabled data-type="compare">${window.siyuan.languages.compare}</button>
                    <span class="fn__space"></span>
                    <button class="b3-button b3-button--outline" data-type="genRepo">
                        <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.createSnapshot}
                    </button>
                </div>    
            </div>
            <ul class="b3-list b3-list--background fn__flex-1" style="padding: 8px 0">
                <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
            </ul>
        </div>
    </div>
</div>`;

    if (isMobile()) {
        openModel({
            html: contentHTML,
            icon: "iconHistory",
            title: window.siyuan.languages.dataHistory,
            bindEvent(element) {
                element.firstElementChild.setAttribute("style", "background-color:var(--b3-theme-background);height:100%");
                bindEvent(app, element.firstElementChild);
            }
        });
    } else {
        const dialog = new Dialog({
            content: contentHTML,
            width: "90vw",
            height: "80vh",
            containerClassName: "b3-dialog__container--theme",
            destroyCallback() {
                historyEditor = undefined;
            }
        });
        dialog.element.setAttribute("data-key", Constants.DIALOG_HISTORY);
        dialog.element.querySelector("input").focus();
        bindEvent(app, dialog.element, dialog);
        resizeSide(dialog.element.querySelector(".history__resize"), dialog.element.querySelector(".history__side"), "sideWidth");
    }
};

const bindEvent = (app: App, element: Element, dialog?: Dialog) => {
    const firstPanelElement = element.querySelector("#historyContainer [data-type=doc]") as HTMLElement;
    firstPanelElement.querySelectorAll(".b3-select").forEach((itemElement) => {
        itemElement.addEventListener("change", () => {
            renderDoc(firstPanelElement, 1);
        });
    });
    firstPanelElement.querySelector(".b3-text-field").addEventListener("input", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        renderDoc(firstPanelElement, 1);
    });
    firstPanelElement.querySelector(".b3-text-field").addEventListener("compositionend", () => {
        renderDoc(firstPanelElement, 1);
    });
    const docElement = firstPanelElement.querySelector('.history__text[data-type="docPanel"]') as HTMLElement;
    const assetElement = firstPanelElement.querySelector('.history__text[data-type="assetPanel"]');
    const mdElement = firstPanelElement.querySelector('.history__text[data-type="mdPanel"]') as HTMLTextAreaElement;
    const titleElement = firstPanelElement.querySelector(".protyle-title__input") as HTMLElement;
    renderDoc(firstPanelElement, 1);
    historyEditor = new Protyle(app, docElement, {
        blockId: "",
        history: {
            created: ""
        },
        action: [Constants.CB_GET_HISTORY],
        render: {
            background: false,
            gutter: false,
            breadcrumb: false,
            breadcrumbDocName: false,
        },
        typewriterMode: false,
    });
    disabledProtyle(historyEditor.protyle);
    const repoElement = element.querySelector('#historyContainer [data-type="repo"]');
    const historyElement = element.querySelector('#historyContainer [data-type="doc"]');
    const repoSelectElement = repoElement.querySelector(".b3-select") as HTMLSelectElement;
    repoSelectElement.addEventListener("change", () => {
        renderRepo(repoElement, 1);
        const btnElement = element.querySelector(".b3-button[data-type='compare']");
        btnElement.setAttribute("disabled", "disabled");
        btnElement.removeAttribute("data-ids");
    });
    element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(element)) {
            const type = target.getAttribute("data-type");
            if (target.classList.contains("item")) {
                target.parentElement.querySelector(".item--focus").classList.remove("item--focus");
                Array.from(element.querySelector("#historyContainer").children).forEach((item: HTMLElement) => {
                    if (item.getAttribute("data-type") === type) {
                        item.classList.remove("fn__none");
                        item.classList.add("fn__block");
                        target.classList.add("item--focus");
                        if (item.getAttribute("data-init") !== "true") {
                            if (type === "notebook") {
                                renderRmNotebook(item);
                            } else if (type === "repo") {
                                renderRepo(item, 1);
                            }
                        }
                    } else {
                        item.classList.add("fn__none");
                        item.classList.remove("fn__block");
                    }
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-list-item__action") && type === "rollback" && !window.siyuan.config.readonly) {
                const dataType = target.parentElement.getAttribute("data-type");
                let name = target.previousElementSibling.previousElementSibling.textContent.trim();
                let time = dayjs(parseInt(target.parentElement.getAttribute("data-created")) * 1000).format("YYYY-MM-DD HH:mm:ss");
                if (dataType === "notebook") {
                    time = target.parentElement.parentElement.previousElementSibling.textContent.trim();
                } else if (dataType === "repoitem") {
                    name = window.siyuan.languages.workspaceData;
                    time = (isMobile() ? target.parentElement.parentElement : target.parentElement).querySelector("span[data-type='hCreated']").textContent.trim();
                }
                const confirmTip = window.siyuan.languages.rollbackConfirm.replace("${name}", name)
                    .replace("${time}", time);
                confirmDialog("⚠️ " + window.siyuan.languages.rollback, confirmTip, () => {
                    if (dataType === "assets") {
                        fetchPost("/api/history/rollbackAssetsHistory", {
                            historyPath: target.parentElement.getAttribute("data-path")
                        });
                    } else if (dataType === "doc") {
                        fetchPost("/api/history/rollbackDocHistory", {
                            notebook: target.parentElement.getAttribute("data-notebook-id"),
                            historyPath: target.parentElement.getAttribute("data-path")
                        });
                    } else if (dataType === "notebook") {
                        fetchPost("/api/history/rollbackNotebookHistory", {
                            historyPath: target.parentElement.getAttribute("data-path")
                        });
                    } else {
                        fetchPost("/api/repo/checkoutRepo", {
                            id: target.parentElement.getAttribute("data-id")
                        });
                    }
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "more") {
                target.parentElement.parentElement.querySelectorAll(".b3-list-item__meta").forEach(item => {
                    item.classList.toggle("fn__none");
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "toggle") {
                const iconElement = target.firstElementChild.firstElementChild;
                if (iconElement.classList.contains("b3-list-item__arrow--open")) {
                    target.nextElementSibling.classList.add("fn__none");
                    iconElement.classList.remove("b3-list-item__arrow--open");
                } else {
                    if (target.nextElementSibling && target.nextElementSibling.tagName === "UL") {
                        target.nextElementSibling.classList.remove("fn__none");
                        iconElement.classList.add("b3-list-item__arrow--open");
                    } else {
                        const inputElement = firstPanelElement.querySelector(".b3-text-field") as HTMLInputElement;
                        const opElement = firstPanelElement.querySelector('.b3-select[data-type="opselect"]') as HTMLSelectElement;
                        const typeElement = firstPanelElement.querySelector('.b3-select[data-type="typeselect"]') as HTMLSelectElement;
                        const notebookElement = firstPanelElement.querySelector('.b3-select[data-type="notebookselect"]') as HTMLSelectElement;
                        const created = target.getAttribute("data-created");
                        fetchPost("/api/history/getHistoryItems", {
                            notebook: notebookElement.value,
                            query: inputElement.value,
                            op: opElement.value,
                            type: parseInt(typeElement.value),
                            created
                        }, (response) => {
                            iconElement.classList.add("b3-list-item__arrow--open");
                            let html = "";
                            let ariaLabel = "";
                            response.data.items.forEach((docItem: {
                                title: string,
                                path: string,
                                op: string,
                                notebook: string
                            }) => {
                                let chipClass = " b3-chip b3-chip--list ";
                                if (docItem.op === "clean") {
                                    chipClass += "b3-chip--primary ";
                                    ariaLabel = window.siyuan.languages.historyClean;
                                } else if (docItem.op === "update") {
                                    chipClass += "b3-chip--info ";
                                    ariaLabel = window.siyuan.languages.historyUpdate;
                                } else if (docItem.op === "delete") {
                                    chipClass += "b3-chip--error ";
                                    ariaLabel = window.siyuan.languages.historyDelete;
                                } else if (docItem.op === "format") {
                                    chipClass += "b3-chip--pink ";
                                    ariaLabel = window.siyuan.languages.historyFormat;
                                } else if (docItem.op === "sync") {
                                    chipClass += "b3-chip--success ";
                                    ariaLabel = window.siyuan.languages.historySync;
                                } else if (docItem.op === "replace") {
                                    chipClass += "b3-chip--secondary ";
                                    ariaLabel = window.siyuan.languages.historyReplace;
                                } else if (docItem.op === "outline") {
                                    chipClass += "b3-chip--warning ";
                                    ariaLabel = window.siyuan.languages.historyOutline;
                                }
                                html += `<li data-notebook-id="${docItem.notebook}" data-created="${created}" data-type="${typeElement.value === "2" ? "assets" : "doc"}" data-path="${docItem.path}" class="b3-list-item b3-list-item--hide-action" style="padding-left: 22px">
    <span class="${opElement.value === "all" ? "" : "fn__none"}${chipClass}ariaLabel" data-position="6south" aria-label="${ariaLabel}">${docItem.op.substring(0, 1).toUpperCase()}</span>
    <span class="b3-list-item__text" title="${escapeAttr(docItem.title)}">${escapeHtml(docItem.title)}</span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action ariaLabel" data-type="rollback" data-position="6south" aria-label="${window.siyuan.languages.rollback}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
</li>`;
                            });
                            target.insertAdjacentHTML("afterend", `<ul>${html}</ul>`);
                        });
                    }
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "rmtoggle") {
                target.nextElementSibling.classList.toggle("fn__none");
                target.firstElementChild.firstElementChild.classList.toggle("b3-list-item__arrow--open");
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-list-item") && type === "repoitem" &&
                ["getRepoSnapshots", "getRepoTagSnapshots"].includes(repoSelectElement.value)) {
                const btnElement = element.querySelector(".b3-button[data-type='compare']");
                const idJSON = JSON.parse(btnElement.getAttribute("data-ids") || "[]");
                const id = target.getAttribute("data-id");
                if (target.classList.contains("b3-list-item--focus")) {
                    target.classList.remove("b3-list-item--focus");
                    idJSON.find((item: { id: string, time: string }, index: number) => {
                        if (id === item.id) {
                            idJSON.splice(index, 1);
                            return true;
                        }
                    });
                } else {
                    target.classList.add("b3-list-item--focus");
                    while (idJSON.length > 1) {
                        if (idJSON[0].id !== id) {
                            target.parentElement.querySelector(`.b3-list-item[data-id="${idJSON.splice(0, 1)[0].id}"]`)?.classList.remove("b3-list-item--focus");
                        } else {
                            idJSON.splice(0, 1);
                        }
                    }
                    idJSON.push({id, time: target.querySelector('[data-type="hCreated"]').textContent});
                }

                if (idJSON.length === 2) {
                    btnElement.removeAttribute("disabled");
                } else {
                    btnElement.setAttribute("disabled", "disabled");
                }
                btnElement.setAttribute("data-ids", JSON.stringify(idJSON));
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-list-item") && (type === "assets" || type === "doc")) {
                const dataPath = target.getAttribute("data-path");
                if (type === "assets") {
                    assetElement.classList.remove("fn__none");
                    assetElement.innerHTML = renderAssetsPreview(dataPath);
                } else if (type === "doc") {
                    const k = (firstPanelElement.querySelector(".b3-text-field") as HTMLInputElement).value;
                    fetchPost("/api/history/getDocHistoryContent", {
                        historyPath: dataPath,
                        highlight: !isSupportCSSHL(),
                        k
                    }, (response) => {
                        if (response.data.isLargeDoc) {
                            mdElement.value = response.data.content;
                            mdElement.classList.remove("fn__none");
                            docElement.classList.add("fn__none");
                        } else {
                            mdElement.classList.add("fn__none");
                            docElement.classList.remove("fn__none");
                            historyEditor.protyle.options.history.created = target.dataset.created;
                            onGet({
                                data: response,
                                protyle: historyEditor.protyle,
                                action: [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML],
                            });
                            searchMarkRender(historyEditor.protyle, k.split(" "));
                        }
                    });
                }
                titleElement.classList.remove("fn__none");
                titleElement.textContent = target.querySelector(".b3-list-item__text").textContent;
                let currentItem = hasClosestByClassName(target, "b3-list") as HTMLElement;
                if (currentItem) {
                    currentItem = currentItem.querySelector(".b3-list-item--focus");
                    if (currentItem) {
                        currentItem.classList.remove("b3-list-item--focus");
                    }
                }
                target.classList.add("b3-list-item--focus");
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "genRepo") {
                const genRepoDialog = new Dialog({
                    title: window.siyuan.languages.snapshotMemo,
                    content: `<div class="b3-dialog__content">
    <textarea class="b3-text-field fn__block" placeholder="${window.siyuan.languages.snapshotMemoTip}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                    width: isMobile() ? "92vw" : "520px",
                });
                genRepoDialog.element.setAttribute("data-key", Constants.DIALOG_SNAPSHOTMEMO);
                const textareaElement = genRepoDialog.element.querySelector("textarea");
                textareaElement.focus();
                const btnsElement = genRepoDialog.element.querySelectorAll(".b3-button");
                genRepoDialog.bindInput(textareaElement, () => {
                    (btnsElement[1] as HTMLButtonElement).click();
                });
                btnsElement[0].addEventListener("click", () => {
                    genRepoDialog.destroy();
                });
                btnsElement[1].addEventListener("click", () => {
                    fetchPost("/api/repo/createSnapshot", {memo: textareaElement.value}, () => {
                        renderRepo(repoElement, 1);
                    });
                    genRepoDialog.destroy();
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "removeRepoTagSnapshot" || type === "removeCloudRepoTagSnapshot") {
                const tag = target.parentElement.getAttribute("data-tag");
                confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.confirmDelete} <i>${tag}</i>?`, () => {
                    fetchPost("/api/repo/" + type, {tag}, () => {
                        renderRepo(repoElement, 1);
                    });
                }, undefined, true);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "uploadSnapshot") {
                fetchPost("/api/repo/uploadCloudSnapshot", {
                    tag: target.parentElement.getAttribute("data-tag"),
                    id: target.parentElement.getAttribute("data-id")
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "downloadSnapshot") {
                fetchPost("/api/repo/downloadCloudSnapshot", {
                    tag: target.parentElement.getAttribute("data-tag"),
                    id: target.parentElement.getAttribute("data-id")
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "downloadRollback" && !window.siyuan.config.readonly) {
                confirmDialog("⚠️ " + window.siyuan.languages.downloadRollback, window.siyuan.languages.rollbackConfirm.replace("${name}", window.siyuan.languages.workspaceData)
                    .replace("${time}", (isMobile() ? target.parentElement.parentElement : target.parentElement).querySelector("span[data-type='hCreated']").textContent.trim()), () => {
                    const repoId = target.parentElement.getAttribute("data-id");
                    fetchPost("/api/repo/downloadCloudSnapshot", {
                        tag: target.parentElement.getAttribute("data-tag"),
                        id: repoId
                    }, () => {
                        fetchPost("/api/repo/checkoutRepo", {
                            id: repoId
                        });
                    });
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "genTag") {
                const genTagDialog = new Dialog({
                    title: window.siyuan.languages.tagSnapshot,
                    content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block" value="${dayjs().format("YYYYMMDDHHmmss")}" placeholder="${window.siyuan.languages.tagSnapshotTip}">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.tagSnapshot}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.tagSnapshotUpload}</button>
</div>`,
                    width: isMobile() ? "92vw" : "520px",
                });
                genTagDialog.element.setAttribute("data-key", Constants.DIALOG_SNAPSHOTTAG);
                const inputElement = genTagDialog.element.querySelector(".b3-text-field") as HTMLInputElement;
                inputElement.select();
                const btnsElement = genTagDialog.element.querySelectorAll(".b3-button");
                btnsElement[0].addEventListener("click", () => {
                    genTagDialog.destroy();
                });
                btnsElement[2].addEventListener("click", () => {
                    fetchPost("/api/repo/tagSnapshot", {
                        id: target.parentElement.getAttribute("data-id"),
                        name: inputElement.value
                    }, () => {
                        fetchPost("/api/repo/uploadCloudSnapshot", {
                            tag: inputElement.value,
                            id: target.parentElement.getAttribute("data-id")
                        }, () => {
                            renderRepo(repoElement, 1);
                        });
                    });
                    genTagDialog.destroy();
                });
                btnsElement[1].addEventListener("click", () => {
                    fetchPost("/api/repo/tagSnapshot", {
                        id: target.parentElement.getAttribute("data-id"),
                        name: inputElement.value
                    }, () => {
                        renderRepo(repoElement, 1);
                    });
                    genTagDialog.destroy();
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if ((type === "previous" || type === "next") && target.getAttribute("disabled") !== "disabled") {
                const currentPage = parseInt(repoElement.getAttribute("data-page"));
                renderRepo(repoElement, type === "previous" ? currentPage - 1 : currentPage + 1);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "jumpRepoPage") {
                const currentPage = parseInt(repoElement.getAttribute("data-page"));
                const totalPage = parseInt(target.getAttribute("data-totalpage") || "1");

                if (totalPage > 1) {
                    confirmDialog(
                        window.siyuan.languages.jumpToPage.replace("${x}", totalPage),
                        `<input class="b3-text-field fn__block" type="number" min="1" max="${totalPage}" value="${currentPage}">`,
                        (confirmD) => {
                            const inputElement = confirmD.element.querySelector(".b3-text-field") as HTMLInputElement;
                            if (inputElement.value === "") {
                                return;
                            }
                            let page = parseInt(inputElement.value);
                            page = Math.max(1, Math.min(page, totalPage));
                            renderRepo(repoElement, page);
                        }
                    );
                }
            } else if (type === "jumpHistoryPage") {
                const currentPage = parseInt(historyElement.getAttribute("data-page"));
                const totalPage = parseInt(target.getAttribute("data-totalpage") || "1");

                if (totalPage > 1) {
                    confirmDialog(
                        window.siyuan.languages.jumpToPage.replace("${x}", totalPage),
                        `<input class="b3-text-field fn__block" type="number" min="1" max="${totalPage}" value="${currentPage}">`,
                        (confirmD) => {
                            const inputElement = confirmD.element.querySelector(".b3-text-field") as HTMLInputElement;
                            if (inputElement.value === "") {
                                return;
                            }
                            let page = parseInt(inputElement.value);
                            page = Math.max(1, Math.min(page, totalPage));
                            renderDoc(firstPanelElement, page);
                        }
                    );
                }
            } else if ((type === "docprevious" || type === "docnext") && target.getAttribute("disabled") !== "disabled") {
                const currentPage = parseInt(firstPanelElement.getAttribute("data-page"));
                renderDoc(firstPanelElement, type === "docprevious" ? currentPage - 1 : currentPage + 1);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "rebuildIndex") {
                fetchPost("/api/history/reindexHistory");
                if (dialog) {
                    dialog.destroy();
                } else {
                    closeModel();
                    historyEditor = undefined;
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "compare" && !target.getAttribute("disabled")) {
                showDiff(app, JSON.parse(target.getAttribute("data-ids") || "[]"));
                event.stopPropagation();
                event.preventDefault();
                break;
            }
            target = target.parentElement;
        }
    });
};
