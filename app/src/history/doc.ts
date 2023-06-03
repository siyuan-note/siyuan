import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {Constants} from "../constants";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {renderAssetsPreview} from "../asset/renderAssets";
import {Protyle} from "../protyle";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import * as dayjs from "dayjs";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {App} from "../index";

let historyEditor: Protyle;

const renderDoc = (element: HTMLElement, currentPage: number, id: string) => {
    const previousElement = element.querySelector('[data-type="docprevious"]');
    const nextElement = element.querySelector('[data-type="docnext"]');
    element.setAttribute("data-page", currentPage.toString());
    if (currentPage > 1) {
        previousElement.removeAttribute("disabled");
    } else {
        previousElement.setAttribute("disabled", "disabled");
    }
    const opElement = element.querySelector('.b3-select[data-type="opselect"]') as HTMLSelectElement;
    const docElement = element.querySelector('.history__text[data-type="docPanel"]');
    const assetElement = element.querySelector('.history__text[data-type="assetPanel"]');
    const mdElement = element.querySelector('.history__text[data-type="mdPanel"]') as HTMLTextAreaElement;
    docElement.classList.add("fn__none");
    mdElement.classList.add("fn__none");
        assetElement.classList.remove("fn__none");
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

export const openDocHistory = (app: App, id: string) => {
    const contentHTML = `<div class="fn__flex-column" style="height: 100%;">
        <div class="block__icons">
            <span data-type="docprevious" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
            <span class="fn__space"></span>
            <span data-type="docnext" class="block__icon block__icon--show b3-tooltips b3-tooltips__e" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
            <span class="fn__space"></span>
            <span>1/1</span>
            <span class="fn__space"></span>
            <div class="fn__flex-1"></div>
            <select data-type="opselect" class="b3-select">
                <option value="all" selected>${window.siyuan.languages.allOp}</option>
                <option value="clean">clean</option>
                <option value="update">update</option>
                <option value="delete">delete</option>
                <option value="format">format</option>
                <option value="sync">sync</option>
                <option value="replace">replace</option>
            </select>
        </div>
        <div class="fn__flex fn__flex-1">
            <ul class="b3-list b3-list--background" style="overflow:auto;">
                <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
            </ul>
            <div class="fn__flex-1 history__text fn__none" data-type="assetPanel"></div>
            <textarea class="fn__flex-1 history__text fn__none" data-type="mdPanel"></textarea>
            <div class="fn__flex-1 history__text fn__none" style="padding: 0" data-type="docPanel"></div>
        </div>
</div>`;
    const dialog = new Dialog({
        content: contentHTML,
        width: isMobile() ? "92vw" : "768px",
        height: isMobile() ? "80vh" : "70vh",
        destroyCallback() {
            historyEditor = undefined;
        }
    });
    bindEvent(app, dialog.element, id);
};

const bindEvent = (app: App, element: HTMLElement, id: string) => {
    element.querySelector(".b3-select").addEventListener("change", () => {
        renderDoc(element, 1, id);
    });
    const docElement = element.querySelector('.history__text[data-type="docPanel"]') as HTMLElement;
    const assetElement = element.querySelector('.history__text[data-type="assetPanel"]');
    const mdElement = element.querySelector('.history__text[data-type="mdPanel"]') as HTMLTextAreaElement;
    renderDoc(element, 1, id);
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
    element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(element)) {
            const type = target.getAttribute("data-type");
            if (target.classList.contains("b3-list-item__action") && type === "rollback" && !window.siyuan.config.readonly) {
                confirmDialog("⚠️ " + window.siyuan.languages.rollback, `${window.siyuan.languages.rollbackConfirm.replace("${date}", target.parentElement.textContent.trim())}`, () => {
                    const dataType = target.parentElement.getAttribute("data-type");
                    if (dataType === "assets") {
                        fetchPost("/api/history/rollbackAssetsHistory", {
                            historyPath: target.parentElement.getAttribute("data-path")
                        });
                    } else if (dataType === "doc") {
                        fetchPost("/api/history/rollbackDocHistory", {
                            // notebook: (firstPanelElement.querySelector('.b3-select[data-type="notebookselect"]') as HTMLSelectElement).value,
                            historyPath: target.parentElement.getAttribute("data-path")
                        });
                    }
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-list-item")) {
                const dataPath = target.getAttribute("data-path");
                if (type === "assets") {
                    assetElement.innerHTML = renderAssetsPreview(dataPath);
                } else if (type === "doc") {
                    fetchPost("/api/history/getDocHistoryContent", {
                        historyPath: dataPath,
                        // k: (firstPanelElement.querySelector(".b3-text-field") as HTMLInputElement).value
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
            } else if ((type === "docprevious" || type === "docnext") && target.getAttribute("disabled") !== "disabled") {
                const currentPage = parseInt(element.getAttribute("data-page"));
                renderDoc(element, type === "docprevious" ? currentPage - 1 : currentPage + 1, id);
                event.stopPropagation();
                event.preventDefault();
                break;
            }
            target = target.parentElement;
        }
    });
};
