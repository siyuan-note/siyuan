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
    if (type === "cloudTag") {
        actionHTML = `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="downloadSnapshot" aria-label="${window.siyuan.languages.download}"><svg><use xlink:href="#iconDownload"></use></svg></span>
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="removeCloudRepoTagSnapshot" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>`;
    } else if (type === "localTag") {
        actionHTML = `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="uploadSnapshot" aria-label="${window.siyuan.languages.upload}"><svg><use xlink:href="#iconUpload"></use></svg></span>
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}"><svg><use xlink:href="#iconUndo"></use></svg></span>
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="removeRepoTagSnapshot" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>`;
    } else if (type === "local") {
        actionHTML = `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="genTag" aria-label="${window.siyuan.languages.tagSnapshot}"><svg><use xlink:href="#iconTags"></use></svg></span>
<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}"><svg><use xlink:href="#iconUndo"></use></svg></span>`;
    }
    let repoHTML = "";
    response.data.snapshots.forEach((item: {
        memo: string,
        id: string,
        hCreated: string,
        count: number,
        hSize: string,
        tag: string,
        typesCount: { type: string, count: number }[]
    }) => {
        if (isMobile()) {
            repoHTML += `<li class="b3-list-item b3-list-item--two" data-type="repoitem">
    <div class="b3-list-item__first">
        <span class="b3-list-item__text">${escapeHtml(item.memo)}</span>
        <span class="b3-chip b3-chip--secondary b3-chip--small${item.tag ? "" : " fn__none"}">${item.tag}</span>
    </div>
    <div>
        <span class="ft__smaller ft__on-surface">${item.hCreated}</span>
        <span class="b3-list-item__meta">${window.siyuan.languages.fileSize} ${item.hSize}</span>
        <span class="b3-list-item__meta">${window.siyuan.languages.fileCount} ${item.count}</span>
    </div>
    <div class="fn__flex" style="justify-content: flex-end;" data-id="${item.id}" data-tag="${item.tag}">${actionHTML}</div>
</li>`;
        } else {
            repoHTML += `<li class="b3-list-item b3-list-item--hide-action" data-type="repoitem" data-id="${item.id}" data-tag="${item.tag}">
    <div class="fn__flex-1">
        <div class="b3-list-item__text">
            ${escapeHtml(item.memo)}
            <span class="b3-chip b3-chip--secondary b3-chip--small${item.tag ? "" : " fn__none"}">${item.tag}</span>
        </div>
        <div>
            <span class="ft__smaller ft__on-surface">${item.hCreated}</span>
            <span class="b3-list-item__meta">${window.siyuan.languages.fileSize} ${item.hSize}</span>
            <span class="b3-list-item__meta">${window.siyuan.languages.fileCount} ${item.count}</span>`;
            let statHTML = "";
            if (item.typesCount && 0 < item.typesCount.length) {
                statHTML += `
           <span class="b3-list-item__meta">
            ${item.typesCount.map((type: { type: string, count: number }) => {
                    return `${type.type} ${type.count}`;
                }).join("&nbsp;&nbsp;")}`;
            }
            repoHTML += `${statHTML}   
            </span>
        </div>
    </div>
    ${actionHTML}
</li>`;
        }
    });
    element.lastElementChild.innerHTML = `${repoHTML}`;
};

const renderRepo = (element: Element, currentPage: number) => {
    element.lastElementChild.innerHTML = '<li style="position: relative;height: 100%;"><div class="fn__loading"><img width="64px" src="/stage/loading-pure.svg"></div></li>';
    const previousElement = element.querySelector('[data-type="previous"]');
    const nextElement = element.querySelector('[data-type="next"]');
    if (currentPage < 0) {
        if (currentPage === -1) {
            fetchPost("/api/repo/getRepoTagSnapshots", {}, (response) => {
                renderRepoItem(response, element, "localTag");
            });
        }
        if (currentPage === -2) {
            fetchPost("/api/repo/getCloudRepoTagSnapshots", {}, (response) => {
                renderRepoItem(response, element, "cloudTag");
            });
        }
        previousElement.classList.add("fn__none");
        nextElement.classList.add("fn__none");
    } else {
        previousElement.classList.remove("fn__none");
        nextElement.classList.remove("fn__none");
        element.setAttribute("data-init", "true");
        element.setAttribute("data-page", currentPage.toString());
        if (currentPage > 1) {
            previousElement.removeAttribute("disabled");
        } else {
            previousElement.setAttribute("disabled", "disabled");
        }
        fetchPost("/api/repo/getRepoSnapshots", {page: currentPage}, (response) => {
            if (currentPage < response.data.pageCount) {
                nextElement.removeAttribute("disabled");
            } else {
                nextElement.setAttribute("disabled", "disabled");
            }
            renderRepoItem(response, element, "local");
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
                    logsHTML += `<li data-type="notebook" data-path="${docItem.path}" class="b3-list-item" style="padding-left: 32px">
    <span class="b3-list-item__text">${escapeHtml(docItem.title)}</span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action" data-type="rollback">
        <svg><use xlink:href="#iconUndo"></use></svg><span class="fn__space"></span>${window.siyuan.languages.rollback}
    </span>
</li>`;
                });
                logsHTML += "</ul>";
            }
        });
        element.innerHTML = logsHTML;
    });
};

export const openHistory = () => {
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

    const currentNotebookId = window.siyuan.storage[Constants.LOCAL_HISTORYNOTEID];
    let notebookSelectHTML = "";
    window.siyuan.notebooks.forEach((item) => {
        if (!item.closed) {
            notebookSelectHTML += ` <option value="${item.id}"${item.id === currentNotebookId ? " selected" : ""}>${item.name}</option>`;
        }
    });
    const dialog = new Dialog({
        content: `<div class="fn__flex-column" style="height: 100%;">
    <div class="layout-tab-bar fn__flex" style="border-radius: 4px 4px 0 0">
        <div data-type="doc" class="item item--full item--focus"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.fileHistory}</span><span class="fn__flex-1"></span></div>
        <div data-type="notebook" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.removedNotebook}</span><span class="fn__flex-1"></span></div>
        <div data-type="repo" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.dataSnapshot}</span><span class="fn__flex-1"></span></div>
    </div>
    <div class="fn__flex-1 fn__flex" id="historyContainer">
        <div data-type="doc" class="history__repo fn__block" data-init="true">
            <div class="fn__flex history__repoheader">
                <span data-type="docprevious" class="block__icon b3-tooltips b3-tooltips__se" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
                <span class="fn__space"></span>
                <span data-type="docnext" class="block__icon b3-tooltips b3-tooltips__se" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
                <div class="fn__flex-1"></div>
                <div style="position: relative">
                    <svg class="b3-form__icon-icon ft__on-surface"><use xlink:href="#iconSearch"></use></svg>
                    <input class="b3-text-field b3-form__icon-input">
                </div>
                <span class="fn__space"></span>
                <select data-type="typeselect" class="b3-select" style="min-width: auto">
                    <option value="0" selected>${window.siyuan.languages.docName}</option>
                    <option value="1">${window.siyuan.languages.docNameAndContent}</option>
                    <option value="2">${window.siyuan.languages.assets}</option>
                </select>
                <span class="fn__space"></span>
                <select data-type="opselect" class="b3-select" style="min-width: auto">
                    <option value="all" selected>${window.siyuan.languages.allOp}</option>
                    <option value="clean">clean</option>
                    <option value="update">update</option>
                    <option value="delete">delete</option>
                    <option value="format">format</option>
                    <option value="sync">sync</option>
                </select>
                <span class="fn__space"></span>
                <select data-type="notebookselect" class="b3-select" style="min-width: auto">
                    ${notebookSelectHTML}
                </select>
                <span class="fn__space"></span>
                <button data-type="rebuildIndex" class="b3-button b3-button--outline">${window.siyuan.languages.rebuildIndex}</button>
            </div>
            <div class="fn__flex fn__flex-1"${isMobile() ? ' style="flex-direction: column;"' : ""}>
                <ul style="${isMobile() ? "height: 30%" : "width:200px"};overflow: auto;padding-bottom: 8px;" class="b3-list b3-list--background">
                    <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
                </ul>
                <div class="fn__flex-1 history__text fn__none" data-type="assetPanel"></div>
                <textarea class="fn__flex-1 history__text fn__none" data-type="mdPanel"></textarea>
                <div class="fn__flex-1 history__text fn__none" style="padding: 0" data-type="docPanel"></div>
            </div>
        </div>
        <ul data-type="notebook" style="background-color: var(--b3-theme-background);border-radius: 0 0 4px 4px;padding-bottom: 8px;" class="fn__none b3-list b3-list--background">
            <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
        </ul>
        <div data-type="repo" class="fn__none history__repo">
            <div class="fn__flex history__repoheader">
                <span data-type="previous" class="block__icon b3-tooltips b3-tooltips__se" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
                <span class="fn__space"></span>
                <span data-type="next" class="block__icon b3-tooltips b3-tooltips__se" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
                <div class="fn__flex-1"></div>
                <select class="b3-select" style="min-width: auto">
                    <option value="0">${window.siyuan.languages.localSnapshot}</option>
                    <option value="1">${window.siyuan.languages.localTagSnapshot}</option>
                    <option value="2">${window.siyuan.languages.cloudTagSnapshot}</option>
                </select>
                <span class="fn__space"></span>
                <button class="b3-button b3-button--outline" data-type="genRepo">
                    <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.createSnapshot}
                </button>
                <span class="fn__space"></span>
                <button class="b3-button b3-button--outline" disabled data-type="compare">${window.siyuan.languages.compare}</button>
            </div>    
            <ul style="background: var(--b3-theme-background);padding-bottom: 8px;" class="b3-list b3-list--background fn__flex-1">
                <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
            </ul>
        </div>
    </div>
</div>`,
        width: "80vw",
        height: "80vh",
        destroyCallback() {
            historyEditor = undefined;
        }
    });

    const firstPanelElement = dialog.element.querySelector("#historyContainer [data-type=doc]") as HTMLElement;
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
    historyEditor = new Protyle(docElement, {
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
    const repoElement = dialog.element.querySelector('#historyContainer [data-type="repo"]');
    const selectElement = repoElement.querySelector(".b3-select") as HTMLSelectElement;
    selectElement.addEventListener("change", () => {
        const value = selectElement.value;
        if (value === "0") {
            renderRepo(repoElement, 1);
        } else if (value === "1") {
            renderRepo(repoElement, -1);
        } else if (value === "2") {
            renderRepo(repoElement, -2);
        }
        const btnElement = dialog.element.querySelector(".b3-button[data-type='compare']");
        btnElement.removeAttribute("disabled");
        btnElement.removeAttribute("data-ids");
    });
    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(dialog.element)) {
            const type = target.getAttribute("data-type");
            if (target.classList.contains("item")) {
                target.parentElement.querySelector(".item--focus").classList.remove("item--focus");
                Array.from(dialog.element.querySelector("#historyContainer").children).forEach((item: HTMLElement) => {
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
                                html += `<li title="${escapeAttr(docItem.title)}" data-type="${typeElement.value === "2" ? "assets" : "doc"}" data-path="${docItem.path}" class="b3-list-item b3-list-item--hide-action" style="padding-left: 44px">
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
                break;
            } else if (type === "rmtoggle") {
                target.nextElementSibling.classList.toggle("fn__none");
                target.firstElementChild.firstElementChild.classList.toggle("b3-list-item__arrow--open");
                break;
            } else if (target.classList.contains("b3-list-item") && type === "repoitem") {
                const btnElement = dialog.element.querySelector(".b3-button[data-type='compare']");
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
                    idJSON.push({id, time: target.querySelector(".ft__smaller").textContent});
                }

                if (idJSON.length === 2) {
                    btnElement.removeAttribute("disabled");
                } else {
                    btnElement.setAttribute("disabled", "disabled");
                }
                btnElement.setAttribute("data-ids", JSON.stringify(idJSON));
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
                            onGet(response, historyEditor.protyle, [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML]);
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
                    width: isMobile() ? "80vw" : "520px",
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
                break;
            } else if (type === "removeRepoTagSnapshot" || type === "removeCloudRepoTagSnapshot") {
                const tag = target.parentElement.getAttribute("data-tag");
                confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.confirmDelete} <i>${tag}</i>?`, () => {
                    fetchPost("/api/repo/" + type, {tag}, () => {
                        renderRepo(repoElement, type === "removeRepoTagSnapshot" ? -1 : -2);
                    });
                });
                break;
            } else if (type === "uploadSnapshot") {
                fetchPost("/api/repo/uploadCloudSnapshot", {
                    tag: target.parentElement.getAttribute("data-tag"),
                    id: target.parentElement.getAttribute("data-id")
                });
                break;
            } else if (type === "downloadSnapshot") {
                fetchPost("/api/repo/downloadCloudSnapshot", {
                    tag: target.parentElement.getAttribute("data-tag"),
                    id: target.parentElement.getAttribute("data-id")
                });
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
                    width: isMobile() ? "80vw" : "520px",
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
                break;
            } else if ((type === "previous" || type === "next") && target.getAttribute("disabled") !== "disabled") {
                const currentPage = parseInt(repoElement.getAttribute("data-page"));
                renderRepo(repoElement, type === "previous" ? currentPage - 1 : currentPage + 1);
                break;
            } else if ((type === "docprevious" || type === "docnext") && target.getAttribute("disabled") !== "disabled") {
                const currentPage = parseInt(firstPanelElement.getAttribute("data-page"));
                renderDoc(firstPanelElement, type === "docprevious" ? currentPage - 1 : currentPage + 1);
                break;
            } else if (type === "rebuildIndex") {
                fetchPost("/api/history/reindexHistory");
                dialog.destroy();
                break;
            } else if (type === "compare") {
                showDiff(JSON.parse(target.getAttribute("data-ids") || "[]"));
                break;
            }
            target = target.parentElement;
        }
    });
};
