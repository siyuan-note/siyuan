import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {fetchPost} from "./fetch";
import {Constants} from "../constants";
import {MenuItem} from "../menus/Menu";
import {unicode2Emoji} from "../emoji";
import {escapeHtml} from "./escape";
import {isMobile} from "./functions";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {renderAssetsPreview} from "../asset/renderAssets";

const renderDoc = (notebook: INotebook, element: HTMLElement) => {
    if (!notebook || !notebook.id) {
        return;
    }
    fetchPost("/api/history/getDocHistory", {
        notebook: notebook.id
    }, (response) => {
        const switchHTML = `<li style="background-color: var(--b3-theme-background)" data-type="switchNotebook" data-menu="true" class="b3-list-item">
    <span class="b3-list-item__icon">${unicode2Emoji(notebook.icon || Constants.SIYUAN_IMAGE_NOTE)}</span>
    <span class="b3-list-item__text">${escapeHtml(notebook.name)}</span>
    <span class="b3-list-item__action" data-type="switchNotebook">
        <svg style="height: 10px"><use xlink:href="#iconDown"></use></svg>
    </span>
</li>`;
        if (response.data.histories.length === 0) {
            element.lastElementChild.innerHTML = "";
            element.firstElementChild.innerHTML = `${switchHTML}<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
            return;
        }
        let logsHTML = switchHTML;
        response.data.histories.forEach((item: { items: { path: string, title: string }[], hCreated: string }, index: number) => {
            logsHTML += `<li class="b3-list-item" data-type="toggle" style="padding-left: 0">
    <span style="padding-left: 8px" class="b3-list-item__toggle"><svg class="b3-list-item__arrow${index === 0 ? " b3-list-item__arrow--open" : ""}${item.items.length > 0 ? "" : " fn__hidden"}"><use xlink:href="#iconRight"></use></svg></span>
    <span class="b3-list-item__text">${item.hCreated}</span>
</li>`;
            if (item.items.length > 0) {
                logsHTML += `<ul class="${index === 0 ? "" : "fn__none"}">`;
                item.items.forEach((docItem, docIndex) => {
                    logsHTML += `<li title="${escapeHtml(docItem.title)}" data-type="doc" data-path="${docItem.path}" class="b3-list-item b3-list-item--hide-action${(index === 0 && docIndex === 0) ? " b3-list-item--focus" : ""}" style="padding-left: 32px">
    <span class="b3-list-item__text">${escapeHtml(docItem.title)}</span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
</li>`;
                });
                logsHTML += "</ul>";

                if (index === 0) {
                    fetchPost("/api/history/getDocHistoryContent", {
                        historyPath: item.items[0].path
                    }, (response) => {
                        element.lastElementChild.innerHTML = response.data.content;
                    });
                }
            }
        });
        element.firstElementChild.innerHTML = logsHTML;
    });
};

const renderAssets = (element: HTMLElement) => {
    element.setAttribute("data-init", "true");
    fetchPost("/api/history/getAssetsHistory", {}, (response) => {
        if (response.data.histories.length === 0) {
            element.lastElementChild.innerHTML = "";
            element.firstElementChild.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
            return;
        }
        let logsHTML = "";
        response.data.histories.forEach((item: { items: { path: string, title: string }[], hCreated: string }, index: number) => {
            logsHTML += `<li class="b3-list-item" data-type="toggle" style="padding-left: 0">
    <span style="padding-left: 8px" class="b3-list-item__toggle"><svg class="b3-list-item__arrow${index === 0 ? " b3-list-item__arrow--open" : ""}${item.items.length > 0 ? "" : " fn__hidden"}"><use xlink:href="#iconRight"></use></svg></span>
    <span class="b3-list-item__text">${item.hCreated}</span>
</li>`;
            if (item.items.length > 0) {
                logsHTML += `<ul class="${index === 0 ? "" : "fn__none"}">`;
                item.items.forEach((docItem, docIndex) => {
                    logsHTML += `<li title="${escapeHtml(docItem.title)}" data-type="assets" data-path="${docItem.path}" class="b3-list-item b3-list-item--hide-action${(index === 0 && docIndex === 0) ? " b3-list-item--focus" : ""}" style="padding-left: 32px">
    <span class="b3-list-item__text">${escapeHtml(docItem.title)}</span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
</li>`;
                });
                logsHTML += "</ul>";

                if (index === 0) {
                    element.lastElementChild.innerHTML = renderAssetsPreview(item.items[0].path);
                }
            }
        });
        element.firstElementChild.innerHTML = logsHTML;
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
    response.data.snapshots.forEach((item: { memo: string, id: string, hCreated: string, count: number, hSize: string, tag: string }) => {
        if (isMobile()) {
            repoHTML += `<li class="b3-list-item b3-list-item--two">
    <div class="b3-list-item__first">
        <span class="b3-list-item__text">${escapeHtml(item.memo)}</span>
        <span class="b3-chip b3-chip--secondary${item.tag ? "" : " fn__none"}">${item.tag}</span>
    </div>
    <div>
        <span class="ft__smaller ft__on-surface">${item.hCreated}</span>
        <span class="b3-list-item__meta">${item.hSize}</span>
        <span class="b3-list-item__meta">${window.siyuan.languages.fileCount}${item.count}</span>
    </div>
    <div class="fn__flex" style="justify-content: flex-end;" data-id="${item.id}" data-tag="${item.tag}">${actionHTML}</div>
</li>`;
        } else {
            repoHTML += `<li class="b3-list-item b3-list-item--hide-action" data-id="${item.id}" data-tag="${item.tag}">
    <div class="fn__flex-1">
        <div class="b3-list-item__text">
            ${escapeHtml(item.memo)}
            <span class="b3-chip b3-chip--secondary${item.tag ? "" : " fn__none"}">${item.tag}</span>
        </div>
        <div>
            <span class="ft__smaller ft__on-surface">${item.hCreated}</span>
            <span class="b3-list-item__meta">${item.hSize}</span>
            <span class="b3-list-item__meta">${window.siyuan.languages.fileCount}${item.count}</span>
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
        response.data.histories.forEach((item: { items: { path: string, title: string }[], hCreated: string }, index: number) => {
            logsHTML += `<li class="b3-list-item" style="padding-left: 0" data-type="toggle">
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
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item.element.querySelector("#historyContainer")) {
            item.destroy();
            return true;
        }
    });
    if (exitDialog) {
        return;
    }

    const dialog = new Dialog({
        content: `<div class="fn__flex-column" style="height: 100%;">
    <div class="layout-tab-bar fn__flex" style="border-radius: 4px 4px 0 0">
        <div data-type="doc" class="item item--focus"><span class="item__text">${window.siyuan.languages.doc}</span></div>
        <div data-type="assets" class="item"><span class="item__text">${window.siyuan.languages.assets}</span></div>
        <div data-type="notebook" class="item"><span class="item__text">${window.siyuan.languages.removedNotebook}</span></div>
        <div data-type="repo" class="item"><span class="item__text">${window.siyuan.languages.dataSnapshot}</span></div>
    </div>
    <div class="fn__flex-1 fn__flex" id="historyContainer">
        <div data-type="doc" class="fn__flex fn__block" data-init="true">
            <ul style="width:200px;overflow: auto;" class="b3-list b3-list--background">
                <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
            </ul>
            <textarea class="fn__flex-1 b3-typography history__text" readonly></textarea>
        </div>
        <div data-type="assets" class="fn__flex fn__none">
            <ul style="width:200px;overflow: auto;" class="b3-list b3-list--background">
                <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
            </ul>
            <div class="fn__flex-1 history__asset"></div>
        </div>
        <ul data-type="notebook" style="background-color: var(--b3-theme-background);border-radius: 0 0 4px 4px" class="fn__none b3-list b3-list--background">
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
            </div>    
            <ul style="background: var(--b3-theme-background);" class="b3-list b3-list--background fn__flex-1">
                <li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>
            </ul>
        </div>
    </div>
</div>`,
        width: "80vw",
        height: "80vh",
    });
    let currentNotebook: INotebook = {
        name: window.siyuan.languages.newFileTip,
        id: "",
        closed: true,
        icon: "",
        sort: 0
    };
    const currentNotebookId = localStorage.getItem(Constants.LOCAL_HISTORYNOTEID);
    window.siyuan.notebooks.find((item) => {
        if (!item.closed) {
            if (!currentNotebook.id) {
                currentNotebook = item;
            }
            if (currentNotebookId) {
                if (item.id === currentNotebookId) {
                    currentNotebook = item;
                    return true;
                }
            } else {
                currentNotebook = item;
                return true;
            }
        }
    });

    const firstPanelElement = dialog.element.querySelector("#historyContainer [data-type=doc]") as HTMLElement;
    renderDoc(currentNotebook, firstPanelElement);
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
                            if (type === "assets") {
                                renderAssets(item);
                            } else if (type === "notebook") {
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
            } else if (type === "switchNotebook") {
                window.siyuan.menus.menu.remove();
                window.siyuan.notebooks.forEach(item => {
                    if (!item.closed) {
                        window.siyuan.menus.menu.append(new MenuItem({
                            label: item.name,
                            click: () => {
                                if (item.id === currentNotebook.id) {
                                    return;
                                }
                                currentNotebook = item;
                                window.localStorage.setItem(Constants.LOCAL_HISTORYNOTEID, item.id);
                                renderDoc(item, firstPanelElement);
                            }
                        }).element);
                    }
                });
                window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
                window.siyuan.menus.menu.element.style.zIndex = "310";
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
                            notebook: currentNotebook.id,
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
                target.nextElementSibling.classList.toggle("fn__none");
                target.firstElementChild.firstElementChild.classList.toggle("b3-list-item__arrow--open");
                break;
            } else if (target.classList.contains("b3-list-item") && (type === "assets" || type === "doc")) {
                const dataPath = target.getAttribute("data-path");
                if (type === "assets") {
                    firstPanelElement.nextElementSibling.lastElementChild.innerHTML = renderAssetsPreview(dataPath);
                } else if (type === "doc") {
                    fetchPost("/api/history/getDocHistoryContent", {
                        historyPath: dataPath
                    }, (response) => {
                        firstPanelElement.lastElementChild.innerHTML = response.data.content;
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
                confirmDialog(window.siyuan.languages.delete, `${window.siyuan.languages.confirmDelete} <i>${tag}</i>?`, () => {
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
    <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.tagSnapshotTip}">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                    width: isMobile() ? "80vw" : "520px",
                });
                const inputElement = genTagDialog.element.querySelector(".b3-text-field") as HTMLInputElement;
                inputElement.focus();
                const btnsElement = genTagDialog.element.querySelectorAll(".b3-button");
                btnsElement[0].addEventListener("click", () => {
                    genTagDialog.destroy();
                });
                genTagDialog.bindInput(inputElement, () => {
                    (btnsElement[1] as HTMLButtonElement).click();
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
            }
            target = target.parentElement;
        }
    });
};
