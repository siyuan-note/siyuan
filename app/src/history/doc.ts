import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {Constants} from "../constants";
import {Protyle} from "../protyle";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import * as dayjs from "dayjs";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {App} from "../index";
import {resizeSide} from "./resizeSide";
import {escapeHtml} from "../util/escape";

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

export const openDocHistory = (options: {
    app: App,
    id: string,
    notebookId: string,
    pathString: string
}) => {
    const contentHTML = `<div class="history__action">
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
        <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
    </ul>
    <div class="history__resize"></div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="protyle-title__input fn__none ft__center ft__breakword"></div>
        <textarea class="fn__flex-1 history__text fn__none" readonly data-type="mdPanel"></textarea>
        <div class="fn__flex-1 history__text fn__none" style="padding: 0" data-type="docPanel"></div>
    </div>
</div>`;
    const dialog = new Dialog({
        title: options.pathString,
        content: contentHTML,
        width: isMobile() ? "100vw" : "90vw",
        height: isMobile() ? "100vh" : "80vh",
        containerClassName: "b3-dialog__container--theme",
        destroyCallback() {
            historyEditor = undefined;
        }
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_HISTORYDOC);

    const opElement = dialog.element.querySelector(".b3-select") as HTMLSelectElement;
    opElement.addEventListener("change", () => {
        renderDoc(dialog.element, 1, options.id);
    });
    const docElement = dialog.element.querySelector('.history__text[data-type="docPanel"]') as HTMLElement;
    const mdElement = dialog.element.querySelector('.history__text[data-type="mdPanel"]') as HTMLTextAreaElement;
    renderDoc(dialog.element, 1, options.id);
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
    const pageNumElement = dialog.element.querySelector('[data-type="jumpRepoPage"]');
    const titleElement = dialog.element.querySelector(".protyle-title__input");
    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(dialog.element)) {
            const type = target.getAttribute("data-type");
            if (type === "rollback" && !isLoading) {
                getHistoryPath(target.parentElement, opElement.value, options.id, (item) => {
                    const dataPath = item.path;
                    isLoading = false;
                    const confirmTip = window.siyuan.languages.rollbackConfirm.replace("${name}", escapeHtml(item.title))
                        .replace("${time}", target.previousElementSibling.previousElementSibling.textContent.trim());
                    confirmDialog("⚠️ " + window.siyuan.languages.rollback, confirmTip, () => {
                        fetchPost("/api/history/rollbackDocHistory", {
                            notebook: options.notebookId,
                            historyPath: dataPath
                        });
                    });
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-list-item") && !isLoading) {
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
                renderDoc(dialog.element, type === "docprevious" ? currentPage - 1 : currentPage + 1, options.id);
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
                        renderDoc(dialog.element, Math.max(1, Math.min(parseInt(inputElement.value), totalPage)), options.id);
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
