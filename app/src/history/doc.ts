import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {Constants} from "../constants";
import {Protyle} from "../protyle";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import * as dayjs from "dayjs";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import type {App} from "../index";
import {resizeSide} from "./resizeSide";
import {escapeHtml} from "../util/escape";
import {openRepoFile, renderRepoFileList, rollbackRepoFile, saveRepoFile} from "./repoFile";

let historyEditor: Protyle;
let isLoading = false;

const renderDoc = (element: HTMLElement, currentPage: number, id: string) => {
    const previousElement = element.querySelector('[data-type="docprevious"]');
    const nextElement = element.querySelector('[data-type="docnext"]');
    if (currentPage > 1) {
        previousElement.removeAttribute("disabled");
    } else {
        previousElement.setAttribute("disabled", "disabled");
    }
    const opElement = element.querySelector('.b3-select[data-type="opselect"]') as HTMLSelectElement;
    const listElement = element.querySelector(".b3-list--background");
    element.querySelector(".protyle-title__input").classList.add("fn__none");
    element.querySelector('.history__text[data-type="docPanel"]').classList.add("fn__none");
    element.querySelector('.history__text[data-type="mdPanel"]').classList.add("fn__none");
    fetchPost("/api/history/searchHistory", {
        query: id,
        page: currentPage,
        op: opElement.value,
        type: 3
    }, (response) => {
        if (currentPage < response.data.pageCount) {
            nextElement.removeAttribute("disabled");
        } else {
            nextElement.setAttribute("disabled", "disabled");
        }
        const pageNumElement = element.querySelector('[data-type="jumpRepoPage"]');
        if (response.data.pageCount > 1) {
            pageNumElement.removeAttribute("disabled");
        } else {
            pageNumElement.setAttribute("disabled", "disabled");
        }
        pageNumElement.setAttribute("data-totalpage", response.data.pageCount.toString());
        pageNumElement.textContent = currentPage.toString();
        const pageInfoElement = nextElement.nextElementSibling.nextElementSibling;
        pageInfoElement.classList.remove("fn__none");
        pageInfoElement.textContent = window.siyuan.languages.pageCountAndHistoryCount.replace("${x}", response.data.pageCount).replace("${y}", response.data.totalCount);
        if (response.data.histories.length === 0) {
            listElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
            return;
        }
        let logsHTML = "";
        response.data.histories.forEach((item: string) => {
            logsHTML += `<li class="b3-list-item b3-list-item--hide-action" data-created="${item}">
    <span class="b3-list-item__text">${dayjs(parseInt(item) * 1000).format("YYYY-MM-DD HH:mm:ss")}</span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
</li>`;
        });
        listElement.innerHTML = logsHTML;
    });
};

const renderRepo = async (element: HTMLElement, currentPage: number, id: string) => {
    if (element.getAttribute("data-loading") === "true") {
        return;
    }
    const previousElement = element.querySelector('[data-type="snapshotprevious"]');
    const nextElement = element.querySelector('[data-type="snapshotnext"]');
    const pageNumElement = element.querySelector('[data-type="jumpSnapshotPage"]');
    const pageInfoElement = nextElement.nextElementSibling.nextElementSibling;
    const listElement = element.querySelector(".b3-list--background");
    element.setAttribute("data-loading", "true");
    element.setAttribute("data-page", currentPage.toString());
    pageNumElement.textContent = currentPage.toString();
    previousElement.setAttribute("disabled", "disabled");
    nextElement.setAttribute("disabled", "disabled");
    listElement.innerHTML = '<li style="position: relative;height: 100%;"><div class="fn__loading"><img width="64px" src="/stage/loading-pure.svg"></div></li>';

    let response: IWebSocketData;
    try {
        response = await fetchSyncPost("/api/repo/getRepoDocHistory", {
            id,
            page: currentPage
        });
    } catch (e) {
        console.warn("get repo doc history failed", e);
        element.removeAttribute("data-loading");
        listElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
        return;
    }
    if (response.code !== 0) {
        element.removeAttribute("data-loading");
        listElement.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
        return;
    }

    element.setAttribute("data-init", "true");
    element.removeAttribute("data-loading");
    const pageCount = response.data.pageCount || 0;
    if (currentPage > 1) {
        previousElement.removeAttribute("disabled");
    }
    if (currentPage < pageCount) {
        nextElement.removeAttribute("disabled");
    }
    pageNumElement.setAttribute("data-totalpage", Math.max(pageCount, 1).toString());
    pageInfoElement.textContent = window.siyuan.languages.pageCountAndSnapshotCount
        .replace("${x}", pageCount)
        .replace("${y}", response.data.totalCount);
    pageInfoElement.classList.remove("fn__none");
    renderRepoFileList(response.data.files, listElement, false);
};

export const openDocHistory = (options: {
    app: App,
    id: string,
    notebookId: string,
    pathString: string
}) => {
    const contentHTML = `<div class="fn__flex-column" style="height: 100%;">
    <div class="layout-tab-bar fn__flex" ${isMobile() ? "" : 'style="border-radius: var(--b3-border-radius-b) var(--b3-border-radius-b) 0 0"'}>
        <div data-type="doc" class="item item--full item--focus"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.fileHistory}</span><span class="fn__flex-1"></span></div>
        <div data-type="repo" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.dataSnapshot}</span><span class="fn__flex-1"></span></div>
    </div>
    <div class="fn__flex-1 fn__flex" id="docHistoryContainer">
        <div data-type="doc" class="history__repo fn__block" data-init="true">
            <div class="history__action">
                <div class="block__icons">
                    <span data-type="docprevious" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href="#iconLeft"></use></svg></span>
                    <button class="b3-button b3-button--text ft__selectnone" data-type="jumpRepoPage" disabled>1</button>
                    <span data-type="docnext" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href="#iconRight"></use></svg></span>
                    <span class="fn__space"></span>
                    <span class="ft__on-surface fn__flex-shrink ft__selectnone fn__none">${window.siyuan.languages.pageCountAndHistoryCount}</span>
                    <span class="fn__space"></span>
                    <div class="fn__flex-1"></div>
                    <select data-type="opselect" class="b3-select">
                        <option value="all" selected>${window.siyuan.languages.allOp}</option>
                        <option value="update">${window.siyuan.languages.historyUpdate}</option>
                        <option value="format">${window.siyuan.languages.historyFormat}</option>
                        <option value="sync">${window.siyuan.languages.historySync}</option>
                        <option value="replace">${window.siyuan.languages.historyReplace}</option>
                        <option value="outline">${window.siyuan.languages.historyOutline}</option>
                    </select>
                </div>
            </div>
            <div class="fn__flex fn__flex-1 history__panel">
                <ul class="b3-list b3-list--background history__side" ${isMobile() ? "" : `style="width: ${window.siyuan.storage[Constants.LOCAL_HISTORY].sideDocWidth}"`}>
                    <li class="fn__loading"><img style="height: 64px;width: 64px" src="/stage/loading-pure.svg"></li>
                </ul>
                <div class="history__resize"></div>
                <div class="fn__flex-1 fn__flex-column">
                    <div class="protyle-title__input fn__none ft__center ft__breakword"></div>
                    <textarea class="fn__flex-1 history__text fn__none" readonly data-type="mdPanel"></textarea>
                    <div class="fn__flex-1 history__text fn__none" style="padding: 0" data-type="docPanel"></div>
                </div>
            </div>
        </div>
        <div data-type="repo" class="fn__none history__repo">
            <div class="history__action">
                <div class="block__icons">
                    <span data-type="snapshotprevious" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href="#iconLeft"></use></svg></span>
                    <button class="b3-button b3-button--text ft__selectnone" data-type="jumpSnapshotPage" data-totalpage="1">1</button>
                    <span data-type="snapshotnext" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href="#iconRight"></use></svg></span>
                    <span class="fn__space"></span>
                    <span class="ft__on-surface fn__flex-shrink ft__selectnone fn__none">${window.siyuan.languages.pageCountAndSnapshotCount}</span>
                    <span class="fn__space"></span>
                    <div class="fn__flex-1"></div>
                </div>
            </div>
            <ul class="b3-list b3-list--background fn__flex-1" style="padding: 8px 0">
                <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
            </ul>
        </div>
    </div>
</div>`;
    const dialog = new Dialog({
        title: options.pathString,
        content: contentHTML,
        width: isMobile() ? "100vw" : "90vw",
        height: isMobile() ? "100dvh" : "80vh",
        containerClassName: "b3-dialog__container--theme",
        destroyCallback() {
            historyEditor = undefined;
        }
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_HISTORYDOC);

    const fileElement = dialog.element.querySelector('#docHistoryContainer [data-type="doc"]') as HTMLElement;
    const repoElement = dialog.element.querySelector('#docHistoryContainer [data-type="repo"]') as HTMLElement;
    const opElement = fileElement.querySelector(".b3-select") as HTMLSelectElement;
    opElement.addEventListener("change", () => {
        renderDoc(fileElement, 1, options.id);
    });
    const docElement = fileElement.querySelector('.history__text[data-type="docPanel"]') as HTMLElement;
    const mdElement = fileElement.querySelector('.history__text[data-type="mdPanel"]') as HTMLTextAreaElement;
    renderDoc(fileElement, 1, options.id);
    historyEditor = new Protyle(options.app, docElement, {
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
    const pageNumElement = fileElement.querySelector('[data-type="jumpRepoPage"]');
    const titleElement = fileElement.querySelector(".protyle-title__input");
    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(dialog.element)) {
            const type = target.getAttribute("data-type");
            const repoFileElement = target.closest('[data-type="searchFileItem"]');
            if (target.classList.contains("item")) {
                target.parentElement.querySelector(".item--focus").classList.remove("item--focus");
                Array.from(dialog.element.querySelector("#docHistoryContainer").children).forEach((item: HTMLElement) => {
                    if (item.getAttribute("data-type") === type) {
                        item.classList.remove("fn__none");
                        item.classList.add("fn__block");
                        target.classList.add("item--focus");
                        if (type === "repo" && item.getAttribute("data-init") !== "true" &&
                            item.getAttribute("data-loading") !== "true") {
                            renderRepo(item, 1, options.id);
                        }
                    } else {
                        item.classList.add("fn__none");
                        item.classList.remove("fn__block");
                    }
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "rollback" && repoFileElement) {
                rollbackRepoFile(repoFileElement);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "saveAs" && repoFileElement) {
                saveRepoFile(repoFileElement);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "view" && repoFileElement) {
                openRepoFile(options.app, repoFileElement);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "rollback" && !isLoading) {
                getHistoryPath(target.parentElement, opElement.value, options.id, (item) => {
                    const dataPath = item.path;
                    isLoading = false;
                    const confirmTip = window.siyuan.languages.rollbackConfirm.replace("${name}", escapeHtml(item.title))
                        .replace("${time}", target.previousElementSibling.previousElementSibling.textContent.trim());
                    confirmDialog("⚠️ " + window.siyuan.languages.rollback, confirmTip, () => {
                        fetchPost("/api/history/rollbackDocHistory", {
                            historyPath: dataPath
                        });
                    });
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-list-item") &&
                target.getAttribute("data-type") !== "searchFileItem" && !isLoading) {
                getHistoryPath(target, opElement.value, options.id, (item) => {
                    const dataPath = item.path;
                    fetchPost("/api/history/getDocHistoryContent", {
                        historyPath: dataPath,
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
                        titleElement.textContent = item.title;
                        titleElement.classList.remove("fn__none");
                        isLoading = false;
                    });
                    target.parentElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                    target.classList.add("b3-list-item--focus");
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if ((type === "docprevious" || type === "docnext") && target.getAttribute("disabled") !== "disabled") {
                const currentPage = parseInt(pageNumElement.textContent);
                renderDoc(fileElement, type === "docprevious" ? currentPage - 1 : currentPage + 1, options.id);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "jumpRepoPage") {
                const totalPage = parseInt(target.getAttribute("data-totalpage") || "1");
                confirmDialog(
                    window.siyuan.languages.jumpToPage.replace("${x}", totalPage),
                    `<input class="b3-text-field fn__block" type="number" min="1" max="${totalPage}" value="${pageNumElement.textContent}">`,
                    (confirmD) => {
                        const inputElement = confirmD.element.querySelector(".b3-text-field") as HTMLInputElement;
                        if (inputElement.value === "") {
                            return;
                        }
                        renderDoc(fileElement, Math.max(1, Math.min(parseInt(inputElement.value), totalPage)), options.id);
                    }
                );
            } else if ((type === "snapshotprevious" || type === "snapshotnext") &&
                target.getAttribute("disabled") !== "disabled") {
                const currentPage = parseInt(repoElement.getAttribute("data-page") || "1");
                renderRepo(repoElement, type === "snapshotprevious" ? currentPage - 1 : currentPage + 1, options.id);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "jumpSnapshotPage") {
                const totalPage = parseInt(target.getAttribute("data-totalpage") || "1");
                confirmDialog(
                    window.siyuan.languages.jumpToPage.replace("${x}", totalPage),
                    `<input class="b3-text-field fn__block" type="number" min="1" max="${totalPage}" value="${target.textContent}">`,
                    (confirmD) => {
                        const inputElement = confirmD.element.querySelector(".b3-text-field") as HTMLInputElement;
                        if (inputElement.value === "") {
                            return;
                        }
                        renderRepo(repoElement, Math.max(1, Math.min(parseInt(inputElement.value), totalPage)), options.id);
                    }
                );
            }
            target = target.parentElement;
        }
    });
    resizeSide(dialog.element.querySelector(".history__resize"), dialog.element.querySelector(".history__side"), "sideDocWidth");
};

const getHistoryPath = (target: Element, op: string, id: string, cb: (item: any) => void) => {
    isLoading = true;
    const path = target.getAttribute("data-path");
    if (path) {
        cb(path);
    }
    const created = target.getAttribute("data-created");
    historyEditor.protyle.options.history.created = created;
    fetchPost("/api/history/getHistoryItems", {
        query: id,
        op,
        type: 3,
        created
    }, (response) => {
        cb(response.data.items[0]);
    });
};
