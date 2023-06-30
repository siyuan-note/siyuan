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
    const inputElement = element.querySelector(".b3-text-field") as HTMLInputElement;
    const opElement = element.querySelector('.b3-select[data-type="opselect"]') as HTMLSelectElement;
    const typeElement = element.querySelector('.b3-select[data-type="typeselect"]') as HTMLSelectElement;
    const notebookElement = element.querySelector('.b3-select[data-type="notebookselect"]') as HTMLSelectElement;
    window.siyuan.storage[Constants.LOCAL_HISTORYNOTEID] = notebookElement.value;
    setStorageVal(Constants.LOCAL_HISTORYNOTEID, window.siyuan.storage[Constants.LOCAL_HISTORYNOTEID]);
    const docElement = element.querySelector('.history__text[data-type="docPanel"]');
    const assetElement = element.querySelector('.history__text[data-type="assetPanel"]');
    const mdElement = element.querySelector('.history__text[data-type="mdPanel"]') as HTMLTextAreaElement;
    docElement.classList.add("fn__none");
    mdElement.classList.add("fn__none");
    if (typeElement.value === "0" || typeElement.value === "1") {
        opElement.removeAttribute("disabled");
        notebookElement.removeAttribute("disabled");
        assetElement.classList.add("fn__none");
    } else {
        opElement.setAttribute("disabled", "disabled");
        notebookElement.setAttribute("disabled", "disabled");
        assetElement.classList.remove("fn__none");
    }
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
        nextElement.nextElementSibling.nextElementSibling.textContent = `${currentPage}/${response.data.pageCount || 1}`;
        if (response.data.histories.length === 0) {
            element.lastElementChild.lastElementChild.previousElementSibling.classList.add("fn__none");
            element.lastElementChild.lastElementChild.classList.add("fn__none");
            element.lastElementChild.firstElementChild.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
            return;
        }
        let logsHTML = "";
        response.data.histories.forEach((item: string) => {
            logsHTML += `<li class="b3-list-item" data-type="toggle" data-created="${item}">
    <span class="b3-list-item__toggle b3-list-item__toggle--hl"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span>
    <span style="padding-left: 4px" class="b3-list-item__text">${dayjs(parseInt(item) * 1000).format("YYYY-MM-DD HH:mm:ss")}</span>
</li>`;
        });
        element.lastElementChild.firstElementChild.innerHTML = logsHTML;
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
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="removeCloudRepoTagSnapshot" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>`;
    } else if (type === "getCloudRepoSnapshots") {
        actionHTML = `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="downloadSnapshot" aria-label="${window.siyuan.languages.download}"><svg><use xlink:href="#iconDownload"></use></svg></span>`;
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
        /// #if MOBILE
        repoHTML += `<li class="b3-list-item" data-type="repoitem" data-id="${item.id}" data-tag="${item.tag}">
<div class="fn__flex-1">
    ${infoHTML}
    <div class="fn__flex" style="height: 26px" data-id="${item.id}" data-tag="${item.tag}">
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
        repoHTML += `<li class="b3-list-item b3-list-item--hide-action" data-type="repoitem" data-id="${item.id}" data-tag="${item.tag}">
<div class="fn__flex-1">${infoHTML}</div>
${actionHTML}
</li>`;
        /// #endif
    });
    element.lastElementChild.innerHTML = `${repoHTML}`;
};

const renderRepo = (element: Element, currentPage: number) => {
    const selectValue = (element.querySelector(".b3-select") as HTMLSelectElement).value;
    element.lastElementChild.innerHTML = '<li style="position: relative;height: 100%;"><div class="fn__loading"><img width="64px" src="/stage/loading-pure.svg"></div></li>';
    const previousElement = element.querySelector('[data-type="previous"]');
    const nextElement = element.querySelector('[data-type="next"]');
    const pageElement = nextElement.nextElementSibling.nextElementSibling;
    element.setAttribute("data-init", "true");
    if (selectValue === "getRepoTagSnapshots" || selectValue === "getCloudRepoTagSnapshots") {
        fetchPost(`/api/repo/${selectValue}`, {}, (response) => {
            renderRepoItem(response, element, selectValue);
        });
        previousElement.classList.add("fn__none");
        nextElement.classList.add("fn__none");
        pageElement.classList.add("fn__none");
    } else {
        previousElement.classList.remove("fn__none");
        nextElement.classList.remove("fn__none");
        pageElement.classList.remove("fn__none");
        element.setAttribute("data-page", currentPage.toString());
        if (currentPage > 1) {
            previousElement.removeAttribute("disabled");
        } else {
            previousElement.setAttribute("disabled", "disabled");
        }
        nextElement.setAttribute("disabled", "disabled");
        fetchPost(`/api/repo/${selectValue}`, {page: currentPage}, (response) => {
            if (currentPage < response.data.pageCount) {
                nextElement.removeAttribute("disabled");
            } else {
                nextElement.setAttribute("disabled", "disabled");
            }
            pageElement.textContent = `${currentPage}/${response.data.pageCount || 1}`;
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

    let notebookSelectHTML = "";
    window.siyuan.notebooks.forEach((item) => {
        if (!item.closed) {
            notebookSelectHTML += ` <option value="${item.id}"${item.id === window.siyuan.storage[Constants.LOCAL_HISTORYNOTEID] ? " selected" : ""}>${escapeHtml(item.name)}</option>`;
        }
    });

    const contentHTML = `<div class="fn__flex-column" style="height: 100%;">
    <div class="layout-tab-bar fn__flex" style="border-radius: var(--b3-border-radius-b) var(--b3-border-radius-b) 0 0">
        <div data-type="doc" class="item item--full item--focus"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.fileHistory}</span><span class="fn__flex-1"></span></div>
        <div data-type="notebook" style="min-width: 160px" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.removedNotebook}</span><span class="fn__flex-1"></span></div>
        <div data-type="repo" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.dataSnapshot}</span><span class="fn__flex-1"></span></div>
    </div>
    <div class="fn__flex-1 fn__flex" id="historyContainer">
        <div data-type="doc" class="history__repo fn__block" data-init="true">
            <div style="overflow:auto;">
                <div class="block__icons">
                    <span data-type="docprevious" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
                    <span class="fn__space"></span>
                    <span data-type="docnext" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
                    <span class="fn__space"></span>
                    <span>1/1</span>
                    <span class="fn__space"></span>
                    <div class="fn__flex-1"></div>
                    <div style="position: relative">
                        <svg class="b3-form__icon-icon ft__on-surface"><use xlink:href="#iconSearch"></use></svg>
                        <input class="b3-text-field b3-form__icon-input ${isMobile() ? "fn__size96" : "fn__size200"}">
                    </div>
                    <span class="fn__space"></span>
                    <select data-type="typeselect" class="b3-select ${isMobile() ? "fn__size96" : "fn__size200"}">
                        <option value="0" selected>${window.siyuan.languages.docName}</option>
                        <option value="1">${window.siyuan.languages.docNameAndContent}</option>
                        <option value="2">${window.siyuan.languages.assets}</option>
                    </select>
                    <span class="fn__space"></span>
                    <select data-type="opselect" class="b3-select${isMobile() ? " fn__size96" : ""}">
                        <option value="all" selected>${window.siyuan.languages.allOp}</option>
                        <option value="clean">clean</option>
                        <option value="update">update</option>
                        <option value="delete">delete</option>
                        <option value="format">format</option>
                        <option value="sync">sync</option>
                        <option value="replace">replace</option>
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
                <ul class="b3-list b3-list--background" style="overflow:auto;">
                    <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
                </ul>
                <div class="fn__flex-1 history__text fn__none" data-type="assetPanel"></div>
                <textarea class="fn__flex-1 history__text fn__none" data-type="mdPanel"></textarea>
                <div class="fn__flex-1 history__text fn__none" style="padding: 0" data-type="docPanel"></div>
            </div>
        </div>
        <ul data-type="notebook" style="padding: 8px 0;" class="fn__none b3-list b3-list--background">
            <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
        </ul>
        <div data-type="repo" class="fn__none history__repo">
            <div style="overflow: auto"">
                <div class="block__icons">
                    <span data-type="previous" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
                    <span class="fn__space"></span>
                    <span data-type="next" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
                    <span class="fn__space"></span>
                    <span>1/1</span>
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
            <ul class="b3-list b3-list--background fn__flex-1" style="padding-bottom: 8px">
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
                bindEvent(app, element.firstElementChild);
            }
        });
    } else {
        const dialog = new Dialog({
            content: contentHTML,
            width: "90vw",
            height: "80vh",
            destroyCallback() {
                historyEditor = undefined;
            }
        });
        bindEvent(app, dialog.element, dialog);
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
    renderDoc(firstPanelElement, 1);
    historyEditor = new Protyle(app, docElement, {
        blockId: "",
        action: [Constants.CB_GET_HISTORY],
        render: {
            background: false,
            title: false,
            gutter: false,
            breadcrumb: false,
            breadcrumbDocName: false,
        },
        typewriterMode: false,
    });
    disabledProtyle(historyEditor.protyle);
    const repoElement = element.querySelector('#historyContainer [data-type="repo"]');
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
                confirmDialog("⚠️ " + window.siyuan.languages.rollback, `${window.siyuan.languages.rollbackConfirm.replace("${date}", target.parentElement.textContent.trim())}`, () => {
                    const dataType = target.parentElement.getAttribute("data-type");
                    if (dataType === "assets") {
                        fetchPost("/api/history/rollbackAssetsHistory", {
                            historyPath: target.parentElement.getAttribute("data-path")
                        });
                    } else if (dataType === "doc") {
                        fetchPost("/api/history/rollbackDocHistory", {
                            notebook: (firstPanelElement.querySelector('.b3-select[data-type="notebookselect"]') as HTMLSelectElement).value,
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
                        fetchPost("/api/history/getHistoryItems", {
                            notebook: notebookElement.value,
                            query: inputElement.value,
                            op: opElement.value,
                            type: parseInt(typeElement.value),
                            created: target.getAttribute("data-created")
                        }, (response) => {
                            iconElement.classList.add("b3-list-item__arrow--open");
                            let html = "";
                            response.data.items.forEach((docItem: { title: string, path: string }) => {
                                html += `<li title="${escapeAttr(docItem.title)}" data-type="${typeElement.value === "2" ? "assets" : "doc"}" data-path="${docItem.path}" class="b3-list-item b3-list-item--hide-action" style="padding-left: 40px">
    <span class="b3-list-item__text">${escapeHtml(docItem.title)}</span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}">
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
                    idJSON.forEach((item: { id: string, time: string }, index: number) => {
                        if (id === item.id) {
                            idJSON.splice(index, 1);
                        }
                    });
                } else {
                    target.classList.add("b3-list-item--focus");
                    while (idJSON.length > 1) {
                        if (idJSON[0].id !== id) {
                            target.parentElement.querySelector(`.b3-list-item[data-id="${idJSON.splice(0, 1)[0].id}"]`)?.classList.remove("b3-list-item--focus");
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
                    assetElement.innerHTML = renderAssetsPreview(dataPath);
                } else if (type === "doc") {
                    fetchPost("/api/history/getDocHistoryContent", {
                        historyPath: dataPath,
                        k: (firstPanelElement.querySelector(".b3-text-field") as HTMLInputElement).value
                    }, (response) => {
                        if (response.data.isLargeDoc) {
                            mdElement.value = response.data.content;
                            mdElement.classList.remove("fn__none");
                            docElement.classList.add("fn__none");
                        } else {
                            mdElement.classList.add("fn__none");
                            docElement.classList.remove("fn__none");
                            onGet({
                                data: response,
                                protyle: historyEditor.protyle,
                                action: [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML],
                            });
                        }
                    });
                }
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
                });
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
