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
import {renderRepoFile, renderRepoFileList, rollbackRepoFile, saveRepoFile} from "./repoFile";
import {showDocVersionDiff, type IDocVersionRef} from "./docDiff";

let historyEditor: Protyle;
const repoHistoryEditors = new WeakMap<HTMLElement, Protyle>();
let isLoading = false;

const genCurrentVersionItem = () => `<li class="b3-list-item history__current-version" data-type="currentVersionItem">
    <span class="b3-list-item__text">${window.siyuan.languages.currentVer}</span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="selectCurrentVersion" aria-pressed="true" aria-label="${window.siyuan.languages.currentVer}">
        <svg><use xlink:href="#iconCheck"></use></svg>
    </span>
</li>`;

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
            listElement.innerHTML = `${genCurrentVersionItem()}<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
            element.dispatchEvent(new CustomEvent("versionListRendered"));
            return;
        }
        let logsHTML = genCurrentVersionItem();
        response.data.histories.forEach((item: string) => {
            logsHTML += `<li class="b3-list-item b3-list-item--hide-action" data-created="${item}">
    <span class="b3-list-item__text">${dayjs(parseInt(item) * 1000).format("YYYY-MM-DD HH:mm:ss")}</span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="selectVersion" aria-pressed="false" aria-label="${window.siyuan.languages.compare}">
        <svg><use xlink:href="#iconUncheck"></use></svg>
    </span>
</li>`;
        });
        listElement.innerHTML = logsHTML;
        element.dispatchEvent(new CustomEvent("versionListRendered"));
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
    const previewElement = element.querySelector('[data-type="repoPanel"]');
    repoHistoryEditors.get(element)?.destroy();
    repoHistoryEditors.delete(element);
    element.querySelector(".protyle-title__input").classList.add("fn__none");
    previewElement.classList.add("fn__none");
    previewElement.removeAttribute("data-request-id");
    previewElement.innerHTML = "";
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
        listElement.innerHTML = `${genCurrentVersionItem()}<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
        element.dispatchEvent(new CustomEvent("versionListRendered"));
        return;
    }
    if (response.code !== 0) {
        element.removeAttribute("data-loading");
        listElement.innerHTML = `${genCurrentVersionItem()}<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
        element.dispatchEvent(new CustomEvent("versionListRendered"));
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
    renderRepoFileList(response.data.files, listElement, false, true);
    listElement.insertAdjacentHTML("afterbegin", genCurrentVersionItem());
    element.dispatchEvent(new CustomEvent("versionListRendered"));
};

export const openDocHistory = (options: {
    app: App,
    id: string,
    notebookId: string,
    pathString: string
}) => {
    const currentVersion = {
        type: "current" as const,
        id: options.id,
        label: window.siyuan.languages.currentVer,
        created: Number.MAX_SAFE_INTEGER,
    };
    const selectedVersions: IDocVersionRef[] = [currentVersion];
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
                    <button class="b3-button b3-button--outline" data-type="compareVersions" disabled>${window.siyuan.languages.compare}</button>
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
                    <button class="b3-button b3-button--outline" data-type="compareVersions" disabled>${window.siyuan.languages.compare}</button>
                    <span class="fn__space"></span>
                    <div class="fn__flex-1"></div>
                </div>
            </div>
            <div class="fn__flex fn__flex-1 history__panel">
                <ul class="b3-list b3-list--background history__side" ${isMobile() ? "" : `style="width: ${window.siyuan.storage[Constants.LOCAL_HISTORY].sideDocWidth}"`}>
                    <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
                </ul>
                <div class="history__resize"></div>
                <div class="fn__flex-1 fn__flex-column">
                    <div class="protyle-title__input fn__none ft__center ft__breakword"></div>
                    <div class="fn__flex-1 history__text fn__none" style="padding: 0" data-type="repoPanel"></div>
                </div>
            </div>
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
            repoHistoryEditors.get(repoElement)?.destroy();
            repoHistoryEditors.delete(repoElement);
        }
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_HISTORYDOC);

    const versionKey = (version: IDocVersionRef) => `${version.type}:${version.id || version.path || ""}`;
    const syncVersionSelection = () => {
        const selectedKeys = new Set(selectedVersions.map(versionKey));
        dialog.element.querySelectorAll('[data-type="selectCurrentVersion"]').forEach((item) => {
            const selected = selectedKeys.has(versionKey(currentVersion));
            item.setAttribute("aria-pressed", selected.toString());
            item.querySelector("use").setAttribute("xlink:href", selected ? "#iconCheck" : "#iconUncheck");
        });
        dialog.element.querySelectorAll('[data-type="selectVersion"]').forEach((item) => {
            const row = item.closest(".b3-list-item");
            const type = row.getAttribute("data-type") === "searchFileItem" ? "snapshot" : "history";
            const id = type === "snapshot" ? row.getAttribute("data-id") : row.getAttribute("data-created");
            const selected = selectedKeys.has(`${type}:${id}`);
            item.setAttribute("aria-pressed", selected.toString());
            item.querySelector("use").setAttribute("xlink:href", selected ? "#iconCheck" : "#iconUncheck");
        });
        dialog.element.querySelectorAll('[data-type="compareVersions"]').forEach((item) => {
            if (selectedVersions.length === 2) {
                item.removeAttribute("disabled");
            } else {
                item.setAttribute("disabled", "disabled");
            }
        });
    };
    const toggleVersionSelection = (version: IDocVersionRef) => {
        const key = versionKey(version);
        const index = selectedVersions.findIndex((item) => versionKey(item) === key);
        if (index > -1) {
            selectedVersions.splice(index, 1);
        } else {
            if (selectedVersions.length === 2) {
                selectedVersions.shift();
            }
            selectedVersions.push(version);
        }
        syncVersionSelection();
    };

    const fileElement = dialog.element.querySelector('#docHistoryContainer [data-type="doc"]') as HTMLElement;
    const repoElement = dialog.element.querySelector('#docHistoryContainer [data-type="repo"]') as HTMLElement;
    fileElement.addEventListener("versionListRendered", syncVersionSelection);
    repoElement.addEventListener("versionListRendered", syncVersionSelection);
    const opElement = fileElement.querySelector(".b3-select") as HTMLSelectElement;
    opElement.addEventListener("change", () => {
        renderDoc(fileElement, 1, options.id);
    });
    const docElement = fileElement.querySelector('.history__text[data-type="docPanel"]') as HTMLElement;
    const mdElement = fileElement.querySelector('.history__text[data-type="mdPanel"]') as HTMLTextAreaElement;
    const repoPreviewElement = repoElement.querySelector('[data-type="repoPanel"]') as HTMLElement;
    const repoTitleElement = repoElement.querySelector(".protyle-title__input") as HTMLElement;
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
    const previewRepoFile = (element: Element) => {
        repoHistoryEditors.get(repoElement)?.destroy();
        repoHistoryEditors.delete(repoElement);
        repoTitleElement.textContent = element.getAttribute("data-title") ||
            element.querySelector(".b3-list-item__text").textContent.trim();
        repoTitleElement.classList.remove("fn__none");
        repoPreviewElement.classList.remove("fn__none");
        renderRepoFile(options.app, element, repoPreviewElement, (editor) => {
            repoHistoryEditors.set(repoElement, editor);
        });
        element.parentElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
        element.classList.add("b3-list-item--focus");
    };
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
            } else if (type === "selectVersion" && repoFileElement) {
                const created = parseInt(repoFileElement.getAttribute("data-created"));
                toggleVersionSelection({
                    type: "snapshot",
                    id: repoFileElement.getAttribute("data-id"),
                    snapshot: repoFileElement.getAttribute("data-snapshot"),
                    label: `${window.siyuan.languages.dataSnapshot} ${dayjs(created).format("YYYY-MM-DD HH:mm:ss")}`,
                    created,
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "view" && repoFileElement) {
                previewRepoFile(repoFileElement);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "selectVersion" && !isLoading) {
                const historyItemElement = target.parentElement;
                const created = parseInt(historyItemElement.getAttribute("data-created")) * 1000;
                getHistoryPath(historyItemElement, opElement.value, options.id, (item) => {
                    isLoading = false;
                    toggleVersionSelection({
                        type: "history",
                        id: historyItemElement.getAttribute("data-created"),
                        path: item.path,
                        label: `${window.siyuan.languages.fileHistory} ${historyItemElement.querySelector(".b3-list-item__text").textContent.trim()}`,
                        created,
                    });
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "selectCurrentVersion") {
                toggleVersionSelection(currentVersion);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "compareVersions" && target.getAttribute("disabled") !== "disabled" &&
                selectedVersions.length === 2) {
                showDocVersionDiff(options.app, selectedVersions[0], selectedVersions[1]);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-list-item") && type === "currentVersionItem") {
                toggleVersionSelection(currentVersion);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "rollback" && !isLoading) {
                const historyItemElement = target.parentElement;
                getHistoryPath(historyItemElement, opElement.value, options.id, (item) => {
                    const dataPath = item.path;
                    isLoading = false;
                    const confirmTip = window.siyuan.languages.rollbackConfirm.replace("${name}", escapeHtml(item.title))
                        .replace("${time}", historyItemElement.querySelector(".b3-list-item__text").textContent.trim());
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
                target.getAttribute("data-type") === "searchFileItem") {
                previewRepoFile(target);
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
    resizeSide(fileElement.querySelector(".history__resize"), fileElement.querySelector(".history__side"), "sideDocWidth");
    resizeSide(repoElement.querySelector(".history__resize"), repoElement.querySelector(".history__side"), "sideDocWidth");
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
