import {escapeHtml} from "../../util/escape";
import {Tab} from "../Tab";
import {Model} from "../Model";
import {getInstanceById, setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {Constants} from "../../constants";
import {getDisplayName, pathPosix, setNoteBook} from "../../util/pathName";
import {newFile} from "../../util/newFile";
import {initFileMenu, initNavigationMenu, sortMenu} from "../../menus/navigation";
import {MenuItem} from "../../menus/Menu";
import {Editor} from "../../editor";
import {showMessage} from "../../dialog/message";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {openEmojiPanel, unicode2Emoji} from "../../emoji";
import {mountHelp, newNotebook} from "../../util/mount";
import {confirmDialog} from "../../dialog/confirmDialog";
import {isNotCtrl, isOnlyMeta, updateHotkeyTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {hasClosestByAttribute, hasClosestByTag, hasTopClosestByTag} from "../../protyle/util/hasClosest";
import {isTouchDevice} from "../../util/functions";
import {App} from "../../index";

export class Files extends Model {
    public element: HTMLElement;
    public parent: Tab;
    private actionsElement: HTMLElement;
    public closeElement: HTMLElement;

    constructor(options: { tab: Tab, app: App }) {
        super({
            app: options.app,
            type: "filetree",
            id: options.tab.id,
            msgCallback(data) {
                if (data) {
                    switch (data.cmd) {
                        case "moveDoc":
                            this.onMove(data);
                            break;
                        case "reloadFiletree":
                            setNoteBook(() => {
                                this.init(false);
                            });
                            break;
                        case "mount":
                            this.onMount(data);
                            break;
                        case "createnotebook":
                            setNoteBook((notebooks) => {
                                let previousId: string;
                                notebooks.find(item => {
                                    if (!item.closed) {
                                        if (item.id === data.data.box.id) {
                                            if (previousId) {
                                                this.element.querySelector(`.b3-list[data-url="${previousId}"]`).insertAdjacentHTML("afterend", this.genNotebook(data.data.box));
                                            } else {
                                                this.element.insertAdjacentHTML("afterbegin", this.genNotebook(data.data.box));
                                            }
                                            return true;
                                        }
                                        previousId = item.id;
                                    }
                                });
                            });
                            break;
                        case "unmount":
                        case "removeDoc":
                            this.onRemove(data);
                            break;
                        case "createdailynote":
                        case "create":
                        case "heading2doc":
                        case "li2doc":
                            this.selectItem(data.data.box.id, data.data.path);
                            break;
                        case "renamenotebook":
                            this.element.querySelector(`[data-url="${data.data.box}"] .b3-list-item__text`).innerHTML = escapeHtml(data.data.name);
                            break;
                        case "rename":
                            this.onRename(data.data);
                            break;
                    }
                }
            },
        });
        options.tab.panelElement.classList.add("fn__flex-column", "file-tree", "sy__file");
        options.tab.panelElement.innerHTML = `<div class="block__icons">
    <div class="block__logo">
        <svg class="block__logoicon"><use xlink:href="#iconFiles"></use></svg>${window.siyuan.languages.fileTree}
    </div>
    <span class="fn__flex-1 fn__space"></span>
    <span data-type="focus" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.selectOpen1} ${updateHotkeyTip(window.siyuan.config.keymap.general.selectOpen1.custom)}"><svg><use xlink:href='#iconFocus'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapse} ${updateHotkeyTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <div class="fn__space${window.siyuan.config.readonly ? " fn__none" : ""}"></div>
    <div data-type="more" class="b3-tooltips b3-tooltips__sw block__icon${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </div> 
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1"></div>
<ul class="b3-list fn__flex-column" style="min-height: auto;transition: var(--b3-transition)">
    <li class="b3-list-item" data-type="toggle">
        <span class="b3-list-item__toggle">
            <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
        </span>
        <span class="b3-list-item__text">${window.siyuan.languages.closeNotebook}</span>
        <span class="counter fn__none" style="cursor: auto"></span>
    </li>
    <ul class="fn__none fn__flex-1"></ul>
</ul>`;
        this.actionsElement = options.tab.panelElement.firstElementChild as HTMLElement;
        this.element = this.actionsElement.nextElementSibling as HTMLElement;
        this.closeElement = options.tab.panelElement.lastElementChild as HTMLElement;
        this.closeElement.addEventListener("click", (event) => {
            setPanelFocus(this.element.parentElement);
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.closeElement)) {
                const type = target.getAttribute("data-type");
                if (target.classList.contains("b3-list-item__icon")) {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = target.getBoundingClientRect();
                    openEmojiPanel(target.parentElement.getAttribute("data-url"), "notebook", {
                        x: rect.left,
                        y: rect.bottom,
                        h: rect.height,
                        w: rect.width,
                    });
                    break;
                } else if (type === "toggle") {
                    if (this.closeElement.classList.contains("fn__flex-1")) {
                        this.closeElement.lastElementChild.classList.add("fn__none");
                        this.closeElement.classList.remove("fn__flex-1");
                        target.querySelector("svg").classList.remove("b3-list-item__arrow--open");
                    } else {
                        this.closeElement.lastElementChild.classList.remove("fn__none");
                        this.closeElement.classList.add("fn__flex-1");
                        target.querySelector("svg").classList.add("b3-list-item__arrow--open");
                    }
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "remove") {
                    confirmDialog(window.siyuan.languages.deleteOpConfirm,
                        `${window.siyuan.languages.confirmDelete} <b>${escapeHtml(target.parentElement.querySelector(".b3-list-item__text").textContent)}</b>?`, () => {
                            fetchPost("/api/notebook/removeNotebook", {
                                notebook: target.getAttribute("data-url"),
                                callback: Constants.CB_MOUNT_REMOVE
                            });
                        });
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "open") {
                    fetchPost("/api/notebook/openNotebook", {
                        notebook: target.getAttribute("data-url")
                    });
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        // 为了快捷键的 dispatch
        this.actionsElement.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            Array.from(this.element.children).forEach(item => {
                const liElement = item.firstElementChild;
                const toggleElement = liElement.querySelector(".b3-list-item__arrow");
                if (toggleElement.classList.contains("b3-list-item__arrow--open")) {
                    toggleElement.classList.remove("b3-list-item__arrow--open");
                    liElement.nextElementSibling.remove();
                }
            });
        });
        this.actionsElement.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.actionsElement)) {
                const type = target.getAttribute("data-type");
                if (type === "min") {
                    getDockByType("file").toggleModel("file", false, true);
                    event.preventDefault();
                    event.stopPropagation();
                    window.siyuan.menus.menu.remove();
                    break;
                } else if (type === "focus") {
                    const element = document.querySelector(".layout__wnd--active > .fn__flex > .layout-tab-bar > .item--focus") ||
                        document.querySelector("ul.layout-tab-bar > .item--focus");
                    if (element) {
                        const tab = getInstanceById(element.getAttribute("data-id")) as Tab;
                        if (tab && tab.model instanceof Editor) {
                            this.selectItem(tab.model.editor.protyle.notebookId, tab.model.editor.protyle.path);
                        }
                    }
                    event.preventDefault();
                    break;
                } else if (type === "more") {
                    this.initMoreMenu().popup({x: event.clientX, y: event.clientY});
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
            setPanelFocus(this.element.parentElement);
        });
        this.element.addEventListener("mousedown", (event) => {
            // 点击鼠标滚轮关闭
            if (event.button !== 1 || !window.siyuan.config.fileTree.openFilesUseCurrentTab) {
                return;
            }
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.tagName === "LI" && !target.getAttribute("data-opening")) {
                    target.setAttribute("data-opening", "true");
                    openFileById({
                        app: options.app,
                        removeCurrentTab: false,
                        id: target.getAttribute("data-node-id"),
                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                        afterOpen() {
                            target.removeAttribute("data-opening");
                        }
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        this.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            const ulElement = hasTopClosestByTag(target, "UL");
            let needFocus = true;
            if (ulElement) {
                const notebookId = ulElement.getAttribute("data-url");
                while (target && !target.isEqualNode(this.element)) {
                    if (isNotCtrl(event) && target.classList.contains("b3-list-item__icon") && window.siyuan.config.system.container !== "ios") {
                        event.preventDefault();
                        event.stopPropagation();
                        const rect = target.getBoundingClientRect();
                        if (target.parentElement.getAttribute("data-type") === "navigation-file") {
                            openEmojiPanel(target.parentElement.getAttribute("data-node-id"), "doc", {
                                x: rect.left,
                                y: rect.bottom,
                                h: rect.height,
                                w: rect.width,
                            });
                        } else {
                            openEmojiPanel(target.parentElement.parentElement.getAttribute("data-url"), "notebook", {
                                x: rect.left,
                                y: rect.bottom,
                                h: rect.height,
                                w: rect.width,
                            });
                        }
                        break;
                    } else if (isNotCtrl(event) && target.classList.contains("b3-list-item__toggle")) {
                        this.getLeaf(target.parentElement, notebookId);
                        event.preventDefault();
                        event.stopPropagation();
                        window.siyuan.menus.menu.remove();
                        break;
                    } else if (isNotCtrl(event) && target.classList.contains("b3-list-item__action")) {
                        const type = target.getAttribute("data-type");
                        const pathString = target.parentElement.getAttribute("data-path");
                        if (!window.siyuan.config.readonly) {
                            if (type === "new") {
                                newFile({
                                    app: options.app,
                                    notebookId,
                                    currentPath: pathString,
                                    useSavePath: false
                                });
                            } else if (type === "more-root") {
                                initNavigationMenu(options.app, target.parentElement).popup({
                                    x: event.clientX,
                                    y: event.clientY
                                });
                            }
                        }
                        if (type === "more-file") {
                            initFileMenu(options.app, notebookId, pathString, target.parentElement).popup({
                                x: event.clientX,
                                y: event.clientY
                            });
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    } else if (target.tagName === "LI") {
                        if (isOnlyMeta(event) && !event.altKey && !event.shiftKey) {
                            target.classList.toggle("b3-list-item--focus");
                        } else {
                            this.setCurrent(target, false);
                            if (target.getAttribute("data-type") === "navigation-file") {
                                needFocus = false;
                                if (target.getAttribute("data-opening")) {
                                    return;
                                }
                                target.setAttribute("data-opening", "true");
                                if (event.altKey && isNotCtrl(event) && !event.shiftKey) {
                                    openFileById({
                                        app: options.app,
                                        id: target.getAttribute("data-node-id"),
                                        position: "right",
                                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                } else if (!event.altKey && isNotCtrl(event) && event.shiftKey) {
                                    openFileById({
                                        app: options.app,
                                        id: target.getAttribute("data-node-id"),
                                        position: "bottom",
                                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                } else if (window.siyuan.config.fileTree.openFilesUseCurrentTab &&
                                    event.altKey && isOnlyMeta(event) && !event.shiftKey) {
                                    openFileById({
                                        app: options.app,
                                        removeCurrentTab: false,
                                        id: target.getAttribute("data-node-id"),
                                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                } else {
                                    openFileById({
                                        app: options.app,
                                        id: target.getAttribute("data-node-id"),
                                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                }
                            } else if (target.getAttribute("data-type") === "navigation-root") {
                                this.getLeaf(target, notebookId);
                            }
                        }
                        this.element.querySelector('[select-end="true"]')?.removeAttribute("select-end");
                        this.element.querySelector('[select-start="true"]')?.removeAttribute("select-start");
                        window.siyuan.menus.menu.remove();
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    }
                    target = target.parentElement;
                }
            }
            if (needFocus) {
                setPanelFocus(this.element.parentElement);
            }
        });
        this.element.addEventListener("dragstart", (event: DragEvent & { target: HTMLElement }) => {
            if (isTouchDevice()) {
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            window.getSelection().removeAllRanges();
            const liElement = hasClosestByTag(event.target, "LI");
            if (liElement) {
                let selectElements: Element[] = Array.from(this.element.querySelectorAll(".b3-list-item--focus"));
                if (!liElement.classList.contains("b3-list-item--focus")) {
                    selectElements.forEach((item) => {
                        item.classList.remove("b3-list-item--focus");
                    });
                    liElement.classList.add("b3-list-item--focus");
                    selectElements = [liElement];
                }
                let ids = "";
                const ghostElement = document.createElement("ul");
                selectElements.forEach((item: HTMLElement, index) => {
                    ghostElement.append(item.cloneNode(true));
                    item.style.opacity = "0.1";
                    const itemNodeId = item.dataset.nodeId ||
                        item.dataset.path; // 拖拽笔记本时值不能为空，否则 drop 就不会继续排序
                    if (itemNodeId) {
                        ids += itemNodeId;
                        if (index < selectElements.length - 1) {
                            ids += ",";
                        }
                    }
                });
                ghostElement.setAttribute("style", `width: 219px;position: fixed;top:-${selectElements.length * 30}px`);
                ghostElement.setAttribute("class", "b3-list b3-list--background");
                document.body.append(ghostElement);
                event.dataTransfer.setDragImage(ghostElement, 16, 16);
                event.dataTransfer.setData(Constants.SIYUAN_DROP_FILE, ids);
                event.dataTransfer.dropEffect = "move";
                window.siyuan.dragElement = document.createElement("div");
                window.siyuan.dragElement.innerText = ids;
                setTimeout(() => {
                    ghostElement.remove();
                });
            }
        });
        this.element.addEventListener("dragend", () => {
            this.element.querySelectorAll(".b3-list-item--focus").forEach((item: HTMLElement) => {
                item.style.opacity = "";
            });
            window.siyuan.dragElement = undefined;
        });
        this.element.addEventListener("dragover", (event: DragEvent & { target: HTMLElement }) => {
            if (window.siyuan.config.readonly) {
                return;
            }
            const contentRect = this.element.getBoundingClientRect();
            if (event.clientY < contentRect.top + Constants.SIZE_SCROLL_TB || event.clientY > contentRect.bottom - Constants.SIZE_SCROLL_TB) {
                this.element.scroll({
                    top: this.element.scrollTop + (event.clientY < contentRect.top + Constants.SIZE_SCROLL_TB ? -Constants.SIZE_SCROLL_STEP : Constants.SIZE_SCROLL_STEP),
                    behavior: "smooth"
                });
            }
            let liElement = hasClosestByTag(event.target, "LI");
            if (!liElement) {
                liElement = hasClosestByTag(document.elementFromPoint(event.clientX, event.clientY - 1), "LI");
            }
            if (!liElement || !window.siyuan.dragElement) {
                event.preventDefault();
                return;
            }
            liElement.classList.remove("dragover__top", "dragover__bottom", "dragover");
            let gutterType = "";
            for (const item of event.dataTransfer.items) {
                if (item.type.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
                    gutterType = item.type;
                }
            }
            if (gutterType) {
                const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
                if (["nodelistitem", "nodeheading"].includes(gutterTypes[0])) {
                    // 块标拖拽
                    liElement.classList.add("dragover");
                }
                event.preventDefault();
                return;
            }
            // 允许标题拖拽到文档树的选中文档上 https://github.com/siyuan-note/siyuan/issues/6552
            if (liElement.classList.contains("b3-list-item--focus")) {
                return;
            }
            let sourceOnlyRoot = true;
            Array.from(this.element.querySelectorAll(".b3-list-item--focus")).find((item: HTMLElement) => {
                if (item.getAttribute("data-type") === "navigation-file") {
                    sourceOnlyRoot = false;
                    return true;
                }
            });
            const targetType = liElement.getAttribute("data-type");
            if (sourceOnlyRoot && targetType !== "navigation-root") {
                event.preventDefault();
                return;
            }
            const notebookElement = hasClosestByAttribute(liElement, "data-sortmode", null);
            if (!notebookElement) {
                return;
            }
            const notebookSort = notebookElement.getAttribute("data-sortmode");
            if ((
                    notebookSort === "6" || (window.siyuan.config.fileTree.sort === 6 && notebookSort === "15")
                ) &&
                // 防止文档拖拽到笔记本外
                !(!sourceOnlyRoot && targetType === "navigation-root")) {
                const nodeRect = liElement.getBoundingClientRect();
                if (event.clientY > nodeRect.top + 20) {
                    liElement.classList.add("dragover__bottom");
                    event.preventDefault();
                } else if (event.clientY < nodeRect.bottom - 20) {
                    liElement.classList.add("dragover__top");
                    event.preventDefault();
                }
            }
            if (liElement.classList.contains("dragover__top") || liElement.classList.contains("dragover__bottom") ||
                (targetType === "navigation-root" && sourceOnlyRoot)) {
                event.preventDefault();
                return;
            }
            liElement.classList.add("dragover");
            event.preventDefault();
        });
        this.element.addEventListener("dragleave", () => {
            this.element.querySelectorAll(".dragover, .dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                item.classList.remove("dragover", "dragover__bottom", "dragover__top");
            });
        });
        this.element.addEventListener("drop", async (event: DragEvent & { target: HTMLElement }) => {
            const newElement = this.element.querySelector(".dragover, .dragover__bottom, .dragover__top");
            if (!newElement) {
                return;
            }
            const newUlElement = hasTopClosestByTag(newElement, "UL");
            if (!newUlElement) {
                return;
            }
            const oldScrollTop = this.element.scrollTop;
            const toURL = newUlElement.getAttribute("data-url");
            const toPath = newElement.getAttribute("data-path");
            let gutterType = "";
            for (const item of event.dataTransfer.items) {
                if (item.type.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
                    gutterType = item.type;
                }
            }
            if (gutterType && newElement.classList.contains("dragover")) {
                const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
                if (["nodelistitem", "nodeheading"].includes(gutterTypes[0])) {
                    // 块标拖拽
                    if (gutterTypes[0] === "nodeheading") {
                        fetchPost("/api/filetree/heading2Doc", {
                            targetNoteBook: toURL,
                            srcHeadingID: gutterTypes[2].split(",")[0],
                            targetPath: toPath,
                            pushMode: 0,
                        });
                    } else {
                        fetchPost("/api/filetree/li2Doc", {
                            pushMode: 0,
                            srcListItemID: gutterTypes[2].split(",")[0],
                            targetNoteBook: toURL,
                            targetPath: toPath
                        });
                    }
                }
                newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
                window.siyuan.dragElement = undefined;
                return;
            }
            window.siyuan.dragElement = undefined;
            if (!event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE)) {
                newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
                return;
            }
            const selectRootElements: HTMLElement[] = [];
            const selectFileElements: HTMLElement[] = [];
            const fromPaths: string[] = [];
            this.element.querySelectorAll(".b3-list-item--focus").forEach((item: HTMLElement) => {
                if (item.getAttribute("data-type") === "navigation-root") {
                    selectRootElements.push(item);
                } else {
                    const dataPath = item.getAttribute("data-path");
                    const isChild = fromPaths.find(itemPath => {
                        if (dataPath.startsWith(itemPath.replace(".sy", ""))) {
                            return true;
                        }
                    });
                    if (!isChild) {
                        selectFileElements.push(item);
                        fromPaths.push(dataPath);
                    }
                }
            });
            if (newElement.classList.contains("dragover")) {
                fetchPost("/api/filetree/moveDocs", {
                    toNotebook: toURL,
                    fromPaths,
                    toPath,
                });
                newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
                return;
            }
            const ulSort = newUlElement.getAttribute("data-sortmode");
            if ((newElement.classList.contains("dragover__bottom") || newElement.classList.contains("dragover__top")) &&
                (ulSort === "6" || (window.siyuan.config.fileTree.sort === 6 && ulSort === "15"))
            ) {
                if (selectRootElements.length > 0 && newElement.getAttribute("data-path") === "/") {
                    if (newElement.classList.contains("dragover__top")) {
                        selectRootElements.forEach(item => {
                            newElement.parentElement.before(item.parentElement);
                        });
                    } else {
                        selectRootElements.reverse().forEach(item => {
                            newElement.parentElement.after(item.parentElement);
                        });
                    }
                    const notebooks: string[] = [];
                    Array.from(this.element.children).forEach(item => {
                        notebooks.push(item.getAttribute("data-url"));
                    });
                    fetchPost("/api/notebook/changeSortNotebook", {
                        notebooks,
                    });
                } else {
                    let hasMove = false;
                    const toDir = pathPosix().dirname(toPath);
                    if (fromPaths.length > 0) {
                        await fetchSyncPost("/api/filetree/moveDocs", {
                            toNotebook: toURL,
                            fromPaths,
                            toPath: toDir === "/" ? "/" : toDir + ".sy",
                            callback: Constants.CB_MOVE_NOLIST,
                        });
                        selectFileElements.forEach(item => {
                            item.setAttribute("data-path", pathPosix().join(toDir, item.getAttribute("data-node-id") + ".sy"));
                        });
                        hasMove = true;
                    }
                    if (newElement.classList.contains("dragover__top")) {
                        selectFileElements.forEach(item => {
                            let nextULElement;
                            if (item.nextElementSibling && item.nextElementSibling.tagName === "UL") {
                                nextULElement = item.nextElementSibling;
                            }
                            newElement.before(item);
                            if (nextULElement) {
                                item.after(nextULElement);
                            }
                        });
                    } else if (newElement.classList.contains("dragover__bottom")) {
                        selectFileElements.reverse().forEach(item => {
                            let nextULElement;
                            if (item.nextElementSibling && item.nextElementSibling.tagName === "UL") {
                                nextULElement = item.nextElementSibling;
                            }
                            if (newElement.nextElementSibling && newElement.nextElementSibling.tagName === "UL") {
                                newElement.nextElementSibling.after(item);
                            } else {
                                newElement.after(item);
                            }
                            if (nextULElement) {
                                item.after(nextULElement);
                            }
                        });
                    }
                    const paths: string[] = [];
                    Array.from(newElement.parentElement.children).forEach(item => {
                        if (item.tagName === "LI") {
                            paths.push(item.getAttribute("data-path"));
                        }
                    });
                    fetchPost("/api/filetree/changeSort", {
                        paths,
                        notebook: toURL
                    }, () => {
                        if (hasMove) {
                            fetchPost("/api/filetree/listDocsByPath", {
                                notebook: toURL,
                                path: toDir === "/" ? "/" : toDir + ".sy",
                            }, response => {
                                if (response.data.path === "/" && response.data.files.length === 0) {
                                    showMessage(window.siyuan.languages.emptyContent);
                                    return;
                                }
                                this.onLsHTML(response.data, oldScrollTop);
                            });
                        }
                    });
                }
            }
            newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
        });
        this.init();
        if (window.siyuan.config.openHelp) {
            // 需等待链接建立，不能放在 ongetconfig 中
            mountHelp();
        }
    }

    private genNotebook(item: INotebook) {
        const emojiHTML = `<span class="b3-list-item__icon b3-tooltips b3-tooltips__e" aria-label="${window.siyuan.languages.changeIcon}">${unicode2Emoji(item.icon || Constants.SIYUAN_IMAGE_NOTE)}</span>`;
        if (item.closed) {
            return `<li data-type="open" data-url="${item.id}" class="b3-list-item b3-list-item--hide-action">
    <span class="b3-list-item__toggle fn__hidden">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    <span class="b3-list-item__text">${escapeHtml(item.name)}</span>
    <span data-type="remove" data-url="${item.id}" class="b3-list-item__action b3-tooltips b3-tooltips__w${(window.siyuan.config.readonly) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.delete}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
</li>`;
        } else {
            return `<ul class="b3-list b3-list--background" data-url="${item.id}" data-sort="${item.sort}" data-sortmode="${item.sortMode}">
<li class="b3-list-item b3-list-item--hide-action" draggable="true" data-type="navigation-root" data-path="/">
    <span class="b3-list-item__toggle b3-list-item__toggle--hl">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    <span class="b3-list-item__text">${escapeHtml(item.name)}</span>
    <span data-type="more-root" class="b3-list-item__action b3-tooltips b3-tooltips__w${(window.siyuan.config.readonly) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action b3-tooltips b3-tooltips__w${(window.siyuan.config.readonly) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.newSubDoc}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>
</li></ul>`;
        }
    }

    public init(init = true) {
        let html = "";
        let closeHtml = "";
        let closeCounter = 0;
        window.siyuan.notebooks.forEach((item) => {
            if (item.closed) {
                closeCounter++;
                closeHtml += this.genNotebook(item);
            } else {
                html += this.genNotebook(item);
            }
        });
        this.element.innerHTML = html;
        this.closeElement.lastElementChild.innerHTML = closeHtml;
        const counterElement = this.closeElement.querySelector(".counter");
        counterElement.textContent = closeCounter.toString();
        if (closeCounter) {
            counterElement.classList.remove("fn__none");
        } else {
            counterElement.classList.add("fn__none");
        }
        if (!init) {
            return;
        }
        if (html === "") {
            this.closeElement.lastElementChild.classList.remove("fn__none");
            this.closeElement.classList.add("fn__flex-1");
        } else {
            this.closeElement.lastElementChild.classList.add("fn__none");
            this.closeElement.classList.remove("fn__flex-1");
        }
    }

    private onRemove(data: IWebSocketData) {
        // "doc2heading" 后删除文件或挂载帮助文档前的 unmount
        if (data.cmd === "unmount") {
            setNoteBook((notebooks) => {
                const targetElement = this.element.querySelector(`ul[data-url="${data.data.box}"] li[data-path="${"/"}"]`);
                if (targetElement) {
                    targetElement.parentElement.remove();
                    if (Constants.CB_MOUNT_REMOVE !== data.callback) {
                        let closeHTML = "";
                        notebooks.find(item => {
                            if (item.closed) {
                                closeHTML += this.genNotebook(item);
                            }
                        });
                        this.closeElement.lastElementChild.innerHTML = closeHTML;
                        const counterElement = this.closeElement.querySelector(".counter");
                        counterElement.textContent = (parseInt(counterElement.textContent) + 1).toString();
                        counterElement.classList.remove("fn__none");
                    }
                }
            });
            if (Constants.CB_MOUNT_REMOVE === data.callback) {
                const removeElement = this.closeElement.querySelector(`li[data-url="${data.data.box}"]`);
                if (removeElement) {
                    removeElement.remove();
                    const counterElement = this.closeElement.querySelector(".counter");
                    counterElement.textContent = (parseInt(counterElement.textContent) - 1).toString();
                    if (counterElement.textContent === "0")  {
                        counterElement.classList.add("fn__none");
                    }
                }
            }
            return;
        }
        data.data.ids.forEach((item: string) => {
            const targetElement = this.element.querySelector(`li.b3-list-item[data-node-id="${item}"]`);
            if (targetElement) {
                // 子节点展开则删除
                if (targetElement.nextElementSibling?.tagName === "UL") {
                    targetElement.nextElementSibling.remove();
                }
                // 移除当前节点
                const parentElement = targetElement.parentElement.previousElementSibling as HTMLElement;
                if (targetElement.parentElement.childElementCount === 1) {
                    if (parentElement) {
                        const iconElement = parentElement.querySelector("svg");
                        iconElement.classList.remove("b3-list-item__arrow--open");
                        if (parentElement.dataset.type !== "navigation-root") {
                            iconElement.parentElement.classList.add("fn__hidden");
                        }
                        const emojiElement = iconElement.parentElement.nextElementSibling;
                        if (emojiElement.innerHTML === unicode2Emoji(Constants.SIYUAN_IMAGE_FOLDER)) {
                            emojiElement.innerHTML = unicode2Emoji(Constants.SIYUAN_IMAGE_FILE);
                        }
                    }
                    targetElement.parentElement.remove();
                } else {
                    targetElement.remove();
                }
            }
        });
    }

    private onMount(data: { data: { box: INotebook, existed?: boolean }, callback?: string }) {
        if (data.data.existed) {
            return;
        }
        const liElement = this.closeElement.querySelector(`li[data-url="${data.data.box.id}"]`) as HTMLElement;
        if (liElement) {
            const counterElement = this.closeElement.querySelector(".counter");
            counterElement.textContent = (parseInt(counterElement.textContent) - 1).toString();
            if (counterElement.textContent === "0") {
                counterElement.classList.add("fn__none");
            }
            liElement.remove();
        }
        setNoteBook((notebooks: INotebook[]) => {
            const html = this.genNotebook(data.data.box);
            if (this.element.childElementCount === 0) {
                this.element.innerHTML = html;
            } else {
                let previousId;
                notebooks.find((item, index) => {
                    if (item.id === data.data.box.id) {
                        while (index > 0) {
                            if (!notebooks[index - 1].closed) {
                                previousId = notebooks[index - 1].id;
                                break;
                            } else {
                                index--;
                            }
                        }
                        return true;
                    }
                });
                if (previousId) {
                    this.element.querySelector(`[data-url="${previousId}"]`).insertAdjacentHTML("afterend", html);
                } else {
                    this.element.insertAdjacentHTML("afterbegin", html);
                }
            }
        });
    }

    public onRename(data: { path: string, title: string, box: string }) {
        const fileItemElement = this.element.querySelector(`ul[data-url="${data.box}"] li[data-path="${data.path}"]`);
        if (!fileItemElement) {
            return;
        }
        fileItemElement.setAttribute("data-name", Lute.EscapeHTMLStr(data.title));
        fileItemElement.querySelector(".b3-list-item__text").innerHTML = escapeHtml(data.title);
    }

    private onMove(response: IWebSocketData) {
        const sourceElement = this.element.querySelector(`ul[data-url="${response.data.fromNotebook}"] li[data-path="${response.data.fromPath}"]`) as HTMLElement;
        if (sourceElement) {
            if (sourceElement.nextElementSibling && sourceElement.nextElementSibling.tagName === "UL") {
                sourceElement.nextElementSibling.remove();
            }
            if (sourceElement.parentElement.childElementCount === 1) {
                if (sourceElement.parentElement.previousElementSibling) {
                    sourceElement.parentElement.previousElementSibling.querySelector(".b3-list-item__toggle").classList.add("fn__hidden");
                    sourceElement.parentElement.previousElementSibling.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
                    const emojiElement = sourceElement.parentElement.previousElementSibling.querySelector(".b3-list-item__icon");
                    if (emojiElement.innerHTML === unicode2Emoji(Constants.SIYUAN_IMAGE_FOLDER)) {
                        emojiElement.innerHTML = unicode2Emoji(Constants.SIYUAN_IMAGE_FILE);
                    }
                }
                sourceElement.parentElement.remove();
            } else {
                sourceElement.remove();
            }
        }
        const newElement = this.element.querySelector(`[data-url="${response.data.toNotebook}"] li[data-path="${response.data.toPath}"]`) as HTMLElement;
        // 更新移动到的新文件夹
        if (newElement) {
            newElement.querySelector(".b3-list-item__toggle").classList.remove("fn__hidden");
            const emojiElement = newElement.querySelector(".b3-list-item__icon");
            if (emojiElement.innerHTML === unicode2Emoji(Constants.SIYUAN_IMAGE_FILE)) {
                emojiElement.innerHTML = unicode2Emoji(Constants.SIYUAN_IMAGE_FOLDER);
            }
            const arrowElement = newElement.querySelector(".b3-list-item__arrow");
            if (arrowElement.classList.contains("b3-list-item__arrow--open")) {
                arrowElement.classList.remove("b3-list-item__arrow--open");
                if (newElement.nextElementSibling && newElement.nextElementSibling.tagName === "UL") {
                    newElement.nextElementSibling.remove();
                }
                if (response.callback !== Constants.CB_MOVE_NOLIST) {
                    this.getLeaf(newElement, response.data.toNotebook);
                }
            }
        }
    }

    private onLsHTML(data: { files: IFile[], box: string, path: string }, scrollTop?: number) {
        let fileHTML = "";
        data.files.forEach((item: IFile) => {
            fileHTML += this.genFileHTML(item);
        });
        if (fileHTML === "") {
            return;
        }
        const liElement = this.element.querySelector(`ul[data-url="${data.box}"] li[data-path="${data.path}"]`);
        if (!liElement) {
            return;
        }
        let nextElement = liElement.nextElementSibling;
        if (nextElement && nextElement.tagName === "UL") {
            // 文件展开时，刷新
            nextElement.remove();
        }
        liElement.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
        liElement.insertAdjacentHTML("afterend", `<ul class="file-tree__sliderDown">${fileHTML}</ul>`);
        nextElement = liElement.nextElementSibling;
        setTimeout(() => {
            nextElement.setAttribute("style", `top: -1px;position: relative;height:${nextElement.childElementCount * (liElement.clientHeight + 1) - 1}px;`);
            setTimeout(() => {
                this.element.querySelectorAll(".file-tree__sliderDown").forEach(item => {
                    item.classList.remove("file-tree__sliderDown");
                    item.removeAttribute("style");
                });
                if (typeof scrollTop === "number") {
                    this.element.scroll({top: scrollTop, behavior: "smooth"});
                }
            }, 120);
        }, 2);
    }

    private onLsSelect(data: { files: IFile[], box: string, path: string }, filePath: string) {
        let fileHTML = "";
        data.files.forEach((item: IFile) => {
            fileHTML += this.genFileHTML(item);
            if (filePath === item.path) {
                this.selectItem(data.box, filePath);
            } else if (filePath.startsWith(item.path.replace(".sy", ""))) {
                fetchPost("/api/filetree/listDocsByPath", {
                    notebook: data.box,
                    path: item.path
                }, response => {
                    this.selectItem(response.data.box, filePath, response.data);
                });
            }
        });
        if (fileHTML === "") {
            return;
        }
        const liElement = this.element.querySelector(`ul[data-url="${data.box}"] li[data-path="${data.path}"]`);
        if (liElement.nextElementSibling && liElement.nextElementSibling.tagName === "UL") {
            // 文件展开时，刷新
            liElement.nextElementSibling.remove();
        }
        const arrowElement = liElement.querySelector(".b3-list-item__arrow");
        arrowElement.classList.add("b3-list-item__arrow--open");
        arrowElement.parentElement.classList.remove("fn__hidden");
        const emojiElement = liElement.querySelector(".b3-list-item__icon");
        if (emojiElement.textContent === unicode2Emoji(Constants.SIYUAN_IMAGE_FILE)) {
            emojiElement.textContent = unicode2Emoji(Constants.SIYUAN_IMAGE_FOLDER);
        }
        liElement.insertAdjacentHTML("afterend", `<ul>${fileHTML}</ul>`);
        this.setCurrent(this.element.querySelector(`ul[data-url="${data.box}"] li[data-path="${filePath}"]`));
    }

    private setCurrent(target: HTMLElement, isScroll = true) {
        if (!target) {
            return;
        }
        this.element.querySelectorAll("li").forEach((liItem) => {
            liItem.classList.remove("b3-list-item--focus");
        });
        target.classList.add("b3-list-item--focus");
        if (isScroll) {
            let offsetTop = target.offsetTop;
            // https://github.com/siyuan-note/siyuan/issues/8749
            if (target.parentElement.classList.contains("file-tree__sliderDown") && target.offsetParent) {
                offsetTop = (target.offsetParent as HTMLElement).offsetTop;
            }
            this.element.scrollTop = offsetTop - this.element.clientHeight / 2 - this.actionsElement.clientHeight;
        }
    }

    public getLeaf(liElement: Element, notebookId: string) {
        const toggleElement = liElement.querySelector(".b3-list-item__arrow");
        if (toggleElement.classList.contains("b3-list-item__arrow--open")) {
            toggleElement.classList.remove("b3-list-item__arrow--open");
            liElement.nextElementSibling?.remove();
            return;
        }
        fetchPost("/api/filetree/listDocsByPath", {
            notebook: notebookId,
            path: liElement.getAttribute("data-path"),
        }, response => {
            if (response.data.path === "/" && response.data.files.length === 0) {
                showMessage(window.siyuan.languages.emptyContent);
                return;
            }
            this.onLsHTML(response.data);
        });
    }

    public selectItem(notebookId: string, filePath: string, data?: { files: IFile[], box: string, path: string }) {
        const treeElement = this.element.querySelector(`[data-url="${notebookId}"]`);
        if (!treeElement) {
            // 有文件树和编辑器的布局初始化时，文件树还未挂载
            return;
        }
        let currentPath = filePath;
        let liElement: HTMLElement;
        while (!liElement) {
            liElement = treeElement.querySelector(`[data-path="${currentPath}"]`);
            if (!liElement) {
                const dirname = pathPosix().dirname(currentPath);
                if (dirname === "/") {
                    currentPath = dirname;
                } else {
                    currentPath = dirname + ".sy";
                }
            }
        }

        if (liElement.getAttribute("data-path") === filePath) {
            this.setCurrent(liElement);
            return;
        }

        if (data && data.path === currentPath) {
            this.onLsSelect(data, filePath);
        } else {
            fetchPost("/api/filetree/listDocsByPath", {
                notebook: notebookId,
                path: currentPath
            }, response => {
                this.onLsSelect(response.data, filePath);
            });
        }
    }

    private genFileHTML = (item: IFile) => {
        let countHTML = "";
        if (item.count && item.count > 0) {
            countHTML = `<span class="popover__block counter b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.ref}">${item.count}</span>`;
        }
        const ariaLabel = `${getDisplayName(item.name, true, true)} <small class='ft__on-surface'>${item.hSize}</small>${item.bookmark ? "<br>" + window.siyuan.languages.bookmark + " " + item.bookmark : ""}${item.name1 ? "<br>" + window.siyuan.languages.name + " " + item.name1 : ""}${item.alias ? "<br>" + window.siyuan.languages.alias + " " + item.alias : ""}${item.memo ? "<br>" + window.siyuan.languages.memo + " " + item.memo : ""}${item.subFileCount !== 0 ? window.siyuan.languages.includeSubFile.replace("x", item.subFileCount) : ""}<br>${window.siyuan.languages.modifiedAt} ${item.hMtime}<br>${window.siyuan.languages.createdAt} ${item.hCtime}`;
        return `<li data-node-id="${item.id}" data-name="${Lute.EscapeHTMLStr(item.name)}" draggable="true" data-count="${item.subFileCount}" 
data-type="navigation-file" 
style="--file-toggle-width:${(item.path.split("/").length - 2) * 18 + 40}px" 
class="b3-list-item b3-list-item--hide-action" data-path="${item.path}">
    <span style="padding-left: ${(item.path.split("/").length - 2) * 18 + 22}px" class="b3-list-item__toggle b3-list-item__toggle--hl${item.subFileCount === 0 ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    <span class="b3-list-item__icon b3-tooltips b3-tooltips__n" aria-label="${window.siyuan.languages.changeIcon}">${unicode2Emoji(item.icon || (item.subFileCount === 0 ? Constants.SIYUAN_IMAGE_FILE : Constants.SIYUAN_IMAGE_FOLDER))}</span>
    <span class="b3-list-item__text ariaLabel" data-position="parentE"
aria-label="${escapeHtml(ariaLabel)}">${getDisplayName(item.name, true, true)}</span>
    <span data-type="more-file" class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action b3-tooltips b3-tooltips__nw${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.newSubDoc}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>
    ${countHTML}
</li>`;
    };

    private initMoreMenu() {
        window.siyuan.menus.menu.remove();
        if (!window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconFilesRoot",
                label: window.siyuan.languages.newNotebook,
                click: () => {
                    newNotebook();
                }
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconRefresh",
            label: window.siyuan.languages.rebuildIndex,
            click: () => {
                if (!this.element.getAttribute("disabled")) {
                    this.element.setAttribute("disabled", "disabled");
                    fetchPost("/api/filetree/refreshFiletree", {}, () => {
                        this.element.removeAttribute("disabled");
                        this.init(false);
                    });
                }
            }
        }).element);
        if (!window.siyuan.config.readonly) {
            const subMenu = sortMenu("notebooks", window.siyuan.config.fileTree.sort, (sort: number) => {
                window.siyuan.config.fileTree.sort = sort;
                fetchPost("/api/setting/setFiletree", {
                    sort: window.siyuan.config.fileTree.sort,
                    alwaysSelectOpenedFile: window.siyuan.config.fileTree.alwaysSelectOpenedFile,
                    refCreateSavePath: window.siyuan.config.fileTree.refCreateSavePath,
                    docCreateSavePath: window.siyuan.config.fileTree.docCreateSavePath,
                    openFilesUseCurrentTab: window.siyuan.config.fileTree.openFilesUseCurrentTab,
                    maxListCount: window.siyuan.config.fileTree.maxListCount,
                }, () => {
                    setNoteBook(() => {
                        this.init(false);
                    });
                });
            });
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconSort",
                label: window.siyuan.languages.sort,
                type: "submenu",
                submenu: subMenu,
            }).element);
        }
        return window.siyuan.menus.menu;
    }
}
