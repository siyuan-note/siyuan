import {escapeHtml} from "../../util/escape";
import {Tab} from "../Tab";
import {Model} from "../Model";
import {getDockByType, getInstanceById, setPanelFocus} from "../util";
import {Constants} from "../../constants";
import {getDisplayName, pathPosix, setNoteBook} from "../../util/pathName";
import {newFile} from "../../util/newFile";
import {initFileMenu, initNavigationMenu} from "../../menus/navigation";
import {MenuItem} from "../../menus/Menu";
import {Editor} from "../../editor";
import {showMessage} from "../../dialog/message";
import {fetchPost} from "../../util/fetch";
import {openEmojiPanel, unicode2Emoji} from "../../emoji";
import {newNotebook} from "../../util/mount";
import {confirmDialog} from "../../dialog/confirmDialog";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {hasClosestByTag, hasTopClosestByTag} from "../../protyle/util/hasClosest";

export class Files extends Model {
    public element: HTMLElement;
    public parent: Tab;
    private actionsElement: HTMLElement;
    public closeElement: HTMLElement;

    constructor(options: { tab: Tab }) {
        super({
            type: "filetree",
            id: options.tab.id,
            msgCallback(data) {
                if (data) {
                    switch (data.cmd) {
                        case "moveDoc":
                            this.onMove(data.data);
                            break;
                        case "mount":
                            this.onMount(data);
                            break;
                        case "createnotebook":
                            setNoteBook();
                            this.element.insertAdjacentHTML("beforeend", this.genNotebook(data.data.box));
                            break;
                        case "unmount":
                        case "remove":
                            this.onRemove(data);
                            break;
                        case "createdailynote":
                        case "create":
                        case "heading2doc":
                        case "li2doc":
                            this.onMkdir(data.data);
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
        <svg><use xlink:href="#iconFiles"></use></svg>
        ${window.siyuan.languages.fileTree}
    </div>
    <span class="fn__flex-1 fn__space"></span>
    <span data-type="focus" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.selectOpen1}"><svg><use xlink:href='#iconFocus'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapseAll} ${updateHotkeyTip("⌘↑")}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <div class="fn__space${window.siyuan.config.readonly ? " fn__none" : ""}"></div>
    <div data-type="more" class="b3-tooltips b3-tooltips__sw block__icon${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </div> 
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1" data-type="navigation"></div>
<ul class="b3-list fn__flex-column" style="min-height: auto;transition: var(--b3-transition)">
    <li class="b3-list-item" data-type="toggle">
        <span class="b3-list-item__toggle">
            <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
        </span>
        <span class="b3-list-item__text">${window.siyuan.languages.closeNotebook}</span>
    </li>
    <ul class="fn__none fn__flex-1"></ul>
</ul>`;
        this.actionsElement = options.tab.panelElement.firstElementChild as HTMLElement;
        this.element = this.actionsElement.nextElementSibling as HTMLElement;
        this.closeElement = options.tab.panelElement.lastElementChild as HTMLElement;
        this.closeElement.addEventListener("click", (event) => {
            setPanelFocus(this.actionsElement);
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.closeElement)) {
                const type = target.getAttribute("data-type");
                if (target.classList.contains("b3-list-item__icon")) {
                    event.preventDefault();
                    event.stopPropagation();
                    openEmojiPanel(target.parentElement.getAttribute("data-url"), target, true);
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
                    confirmDialog(window.siyuan.languages.delete,
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
                    const element = document.querySelector(".layout__wnd--active > .layout-tab-bar > .item--focus") ||
                        document.querySelector(".layout-tab-bar > .item--focus");
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
            setPanelFocus(this.actionsElement);
        });
        let clickTimeout: number;
        this.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            const ulElement = hasTopClosestByTag(target, "UL");
            let needFocus = true;
            if (ulElement) {
                const notebookId = ulElement.getAttribute("data-url");
                while (target && !target.isEqualNode(this.element)) {
                    if (target.classList.contains("b3-list-item__icon") && window.siyuan.config.system.container !== "ios") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (target.parentElement.getAttribute("data-type") === "navigation-file") {
                            openEmojiPanel(target.parentElement.getAttribute("data-node-id"), target, false);
                        } else {
                            openEmojiPanel(target.parentElement.parentElement.getAttribute("data-url"), target, true);
                        }
                        break;
                    } else if (target.classList.contains("b3-list-item__toggle")) {
                        this.getLeaf(target.parentElement, notebookId);
                        this.setCurrent(target.parentElement);
                        event.preventDefault();
                        event.stopPropagation();
                        window.siyuan.menus.menu.remove();
                        break;
                    } else if (target.classList.contains("b3-list-item__action")) {
                        const type = target.getAttribute("data-type");
                        const pathString = target.parentElement.getAttribute("data-path");
                        if (!window.siyuan.config.readonly) {
                            if (type === "new") {
                                newFile(notebookId, pathString, true);
                            } else if (type === "more-root") {
                                initNavigationMenu(target.parentElement).popup({x: event.clientX, y: event.clientY});
                            }
                        }
                        if (type === "more-file") {
                            initFileMenu(notebookId, pathString, target.parentElement.getAttribute("data-node-id"), target.parentElement.getAttribute("data-name")).popup({
                                x: event.clientX,
                                y: event.clientY
                            });
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    } else if (target.tagName === "LI") {
                        if (event.detail === 1) {
                            needFocus = false;
                            clickTimeout = window.setTimeout(() => {
                                this.setCurrent(target);
                                if (target.getAttribute("data-type") === "navigation-file") {
                                    if (window.siyuan.altIsPressed) {
                                        openFileById({
                                            id: target.getAttribute("data-node-id"),
                                            position: "right",
                                            action: [Constants.CB_GET_FOCUS]
                                        });
                                    } else {
                                        openFileById({
                                            id: target.getAttribute("data-node-id"),
                                            action: [Constants.CB_GET_FOCUS]
                                        });
                                    }
                                } else if (target.getAttribute("data-type") === "navigation-root") {
                                    this.getLeaf(target, notebookId);
                                    setPanelFocus(this.actionsElement);
                                }
                            }, Constants.TIMEOUT_DBLCLICK);
                        } else if (event.detail === 2) {
                            clearTimeout(clickTimeout);
                            this.getLeaf(target, notebookId);
                            this.setCurrent(target);
                        }
                        window.siyuan.menus.menu.remove();
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    }
                    target = target.parentElement;
                }
            }
            if (needFocus) {
                setPanelFocus(this.actionsElement);
            }
        });
        // b3-list-item--focus 样式会遮挡拖拽排序的上下线条
        let focusElement: HTMLElement;
        this.element.addEventListener("dragstart", (event: DragEvent & { target: HTMLElement }) => {
            window.getSelection().removeAllRanges();
            focusElement = this.element.querySelector(".b3-list-item--focus");
            if (focusElement) {
                focusElement.classList.remove("b3-list-item--focus");
            }
            const liElement = hasClosestByTag(event.target, "LI");
            if (liElement) {
                const ulElement = hasTopClosestByTag(liElement, "UL");
                event.dataTransfer.setData("text/html", liElement.outerHTML);
                if (ulElement) {
                    event.dataTransfer.setData(Constants.SIYUAN_DROP_FILE, ulElement.getAttribute("data-url"));
                }
                event.dataTransfer.dropEffect = "move";
                liElement.style.opacity = "0.1";
                window.siyuan.dragElement = liElement;
            }
        });
        this.element.addEventListener("dragend", (event: DragEvent & { target: HTMLElement }) => {
            const liElement = hasClosestByTag(event.target, "LI");
            if (liElement) {
                liElement.style.opacity = "1";
            }
            if (focusElement) {
                focusElement.classList.add("b3-list-item--focus");
                focusElement = undefined;
            }
            window.siyuan.dragElement = undefined;
        });
        this.element.addEventListener("dragover", (event: DragEvent & { target: HTMLElement }) => {
            if (window.siyuan.config.readonly) {
                return;
            }
            const liElement = hasClosestByTag(event.target, "LI");
            if (!liElement || !window.siyuan.dragElement || liElement.isSameNode(window.siyuan.dragElement)) {
                event.preventDefault();
                return;
            }
            liElement.classList.remove("dragover__top", "dragover__bottom", "dragover");
            const sourceType = window.siyuan.dragElement.getAttribute("data-type");
            if (["NodeListItem", "NodeHeading"].includes(sourceType)) {
                // 编辑器情景菜单拖拽
                liElement.classList.add("dragover");
                event.preventDefault();
                return;
            }
            const targetType = liElement.getAttribute("data-type");
            if (sourceType === "navigation-root" && targetType !== "navigation-root") {
                event.preventDefault();
                return;
            }
            if (window.siyuan.config.fileTree.sort === 6 &&
                // 防止文档拖拽到笔记本外
                !(sourceType === "navigation-file" && targetType === "navigation-root")) {
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
                (targetType === "navigation-root" && sourceType === "navigation-root")) {
                event.preventDefault();
                return;
            }
            liElement.classList.add("dragover");
            event.preventDefault();
        });
        this.element.addEventListener("dragleave", (event: DragEvent & { target: HTMLElement }) => {
            const liElement = hasClosestByTag(event.target, "LI");
            if (liElement) {
                liElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
            }
        });
        this.element.addEventListener("drop", async (event: DragEvent & { target: HTMLElement }) => {
            const newElement = hasClosestByTag(event.target, "LI");
            if (!newElement) {
                return;
            }
            const newUlElement = hasTopClosestByTag(newElement, "UL");
            if (!newUlElement) {
                return;
            }
            const toURL = newUlElement.getAttribute("data-url");
            const toPath = newElement.getAttribute("data-path");
            const fromType = window.siyuan.dragElement.getAttribute("data-type");
            if (newElement.classList.contains("dragover") && ["NodeListItem", "NodeHeading"].includes(fromType)) {
                // 编辑器情景菜单拖拽
                if (fromType === "NodeHeading") {
                    fetchPost("/api/filetree/heading2Doc", {
                        targetNoteBook: toURL,
                        srcHeadingID: window.siyuan.dragElement.getAttribute("data-node-id"),
                        targetPath: toPath,
                        pushMode: 0,
                    });
                } else {
                    fetchPost("/api/filetree/li2Doc", {
                        pushMode: 0,
                        srcListItemID: window.siyuan.dragElement.getAttribute("data-node-id"),
                        targetNoteBook: toURL,
                        targetPath: toPath
                    });
                }
                newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
                return;
            }

            const fromURL = event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE);
            const fromPath = window.siyuan.dragElement.getAttribute("data-path");
            if ((!fromURL || !fromPath || fromPath === toPath) && fromType !== "navigation-root") {
                newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
                return;
            }
            if (newElement.classList.contains("dragover")) {
                await fetchPost("/api/filetree/moveDoc", {
                    fromNotebook: fromURL,
                    toNotebook: toURL,
                    fromPath,
                    toPath,
                });
            }
            if ((newElement.classList.contains("dragover__bottom") || newElement.classList.contains("dragover__top")) && window.siyuan.config.fileTree.sort === 6) {
                if (fromType === "navigation-root") {
                    if (newElement.classList.contains("dragover__top")) {
                        newElement.parentElement.before(window.siyuan.dragElement.parentElement);
                    } else {
                        newElement.parentElement.after(window.siyuan.dragElement.parentElement);
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
                    if (fromType !== "navigation-root" && (toDir !== pathPosix().dirname(fromPath) || fromURL !== toURL)) {
                        await fetchPost("/api/filetree/moveDoc", {
                            fromNotebook: fromURL,
                            toNotebook: toURL,
                            fromPath,
                            toPath: toDir === "/" ? "/" : toDir + ".sy",
                        });
                        window.siyuan.dragElement.setAttribute("data-path", pathPosix().join(toDir, window.siyuan.dragElement.getAttribute("data-node-id") + ".sy"));
                        hasMove = true;
                    }
                    let nextULElement;
                    if (window.siyuan.dragElement.nextElementSibling && window.siyuan.dragElement.nextElementSibling.tagName === "UL") {
                        nextULElement = window.siyuan.dragElement.nextElementSibling;
                    }
                    if (newElement.classList.contains("dragover__bottom")) {
                        if (newElement.nextElementSibling && newElement.nextElementSibling.tagName === "UL") {
                            newElement.nextElementSibling.after(window.siyuan.dragElement);
                        } else {
                            newElement.after(window.siyuan.dragElement);
                        }
                    } else if (newElement.classList.contains("dragover__top")) {
                        newElement.before(window.siyuan.dragElement);
                    }
                    if (nextULElement) {
                        window.siyuan.dragElement.after(nextULElement);
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
                            // 移动并排序后，会推送 moveDoc，但此时还没有 sort。 https://github.com/siyuan-note/siyuan/issues/4270
                            fetchPost("/api/filetree/listDocsByPath", {
                                notebook: toURL,
                                path: pathPosix().dirname(toPath),
                                sort: window.siyuan.config.fileTree.sort,
                            }, response => {
                                if (response.data.path === "/" && response.data.files.length === 0) {
                                    showMessage(window.siyuan.languages.emptyContent);
                                    return;
                                }
                                this.onLsHTML(response.data);
                            });
                        }
                    });
                }
            }
            newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
        });
        this.init();
        setPanelFocus(this.actionsElement);
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
            return `<ul class="b3-list b3-list--background" data-url="${item.id}" data-sort="${item.sort}">
<li class="b3-list-item b3-list-item--hide-action" draggable="true" data-type="navigation-root" data-path="/">
    <span class="b3-list-item__toggle">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    <span class="b3-list-item__text">${escapeHtml(item.name)}</span>
    <span data-type="more-root" class="b3-list-item__action b3-tooltips b3-tooltips__w${(window.siyuan.config.readonly) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action b3-tooltips b3-tooltips__w${(window.siyuan.config.readonly) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.newFile}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>
</li></ul>`;
        }
    }

    private init(init = true) {
        let html = "";
        let closeHtml = "";
        window.siyuan.notebooks.forEach((item) => {
            if (item.closed) {
                closeHtml += this.genNotebook(item);
            } else {
                html += this.genNotebook(item);
            }
        });
        this.element.innerHTML = html;
        this.closeElement.lastElementChild.innerHTML = closeHtml;
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

    private onMkdir(data: {
        box: INotebook,
        path: string,
    }) {
        let targetElement = this.element.querySelector(`ul[data-url="${data.box.id}"]`);
        let folderPath = pathPosix().dirname(data.path) + ".sy";
        while (folderPath !== "/") {
            targetElement = targetElement.querySelector(`li[data-path="${folderPath}"]`);
            if (targetElement) {
                break;
            } else {
                targetElement = this.element.querySelector(`ul[data-url="${data.box.id}"]`);
                // 向上查找
                if (folderPath === "/.sy") {
                    folderPath = "/"; // https://github.com/siyuan-note/siyuan/issues/3895
                } else {
                    folderPath = pathPosix().dirname(folderPath) + ".sy";
                }
            }
        }
        if (targetElement.tagName === "UL") {
            // 日记不存在时，创建日记需要添加文档
            targetElement = targetElement.firstElementChild as HTMLElement;
        }

        if (targetElement) {
            targetElement.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
            targetElement.querySelector(".b3-list-item__toggle").classList.remove("fn__hidden");
            if (targetElement.nextElementSibling && targetElement.nextElementSibling.tagName === "UL") {
                targetElement.nextElementSibling.remove();
            }
            this.getLeaf(targetElement, data.box.id);
        }
    }

    private onRemove(data: IWebSocketData) {
        // "doc2heading" 后删除文件或挂载帮助文档前的 unmount
        const targetElement = this.element.querySelector(`ul[data-url="${data.data.box}"] li[data-path="${data.data.path || "/"}"]`);
        if (data.cmd === "unmount") {
            setNoteBook((notebooks) => {
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
                    }
                }
            });
            if (Constants.CB_MOUNT_REMOVE === data.callback) {
                const removeElement = this.closeElement.querySelector(`li[data-url="${data.data.box}"]`);
                if (removeElement) {
                    removeElement.remove();
                }
            }
        } else if (targetElement) {
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
                    iconElement.parentElement.classList.add("fn__hidden");
                }
                targetElement.parentElement.remove();
            } else {
                targetElement.remove();
            }
        }
    }

    private onMount(data: { data: { box: INotebook, existed?: boolean }, callback?: string }) {
        if (data.data.existed) {
            return;
        }
        const liElement = this.closeElement.querySelector(`li[data-url="${data.data.box.id}"]`) as HTMLElement;
        if (liElement) {
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
            if (data.callback === Constants.CB_MOUNT_HELP) {
                openFileById({
                    id: Constants.HELP_START_PATH[window.siyuan.config.appearance.lang as "zh_CN" | "en_US"],
                    action: [Constants.CB_GET_FOCUS]
                });
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

    private onMove(data: {
        fromNotebook: string,
        toNotebook: string,
        fromPath: string
        toPath: string
    }) {
        const sourceElement = this.element.querySelector(`ul[data-url="${data.fromNotebook}"] li[data-path="${data.fromPath}"]`) as HTMLElement;
        if (sourceElement) {
            if (sourceElement.nextElementSibling && sourceElement.nextElementSibling.tagName === "UL") {
                sourceElement.nextElementSibling.remove();
            }
            if (sourceElement.parentElement.childElementCount === 1) {
                if (sourceElement.parentElement.previousElementSibling) {
                    sourceElement.parentElement.previousElementSibling.querySelector(".b3-list-item__toggle").classList.add("fn__hidden");
                    sourceElement.parentElement.previousElementSibling.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
                }
                sourceElement.parentElement.remove();
            } else {
                sourceElement.remove();
            }
        }
        const newElement = this.element.querySelector(`[data-url="${data.toNotebook}"] li[data-path="${data.toPath}"]`) as HTMLElement;
        // 更新移动到的新文件夹
        if (newElement) {
            newElement.querySelector(".b3-list-item__toggle").classList.remove("fn__hidden");
            const arrowElement = newElement.querySelector(".b3-list-item__arrow");
            if (arrowElement.classList.contains("b3-list-item__arrow--open")) {
                arrowElement.classList.remove("b3-list-item__arrow--open");
                if (newElement.nextElementSibling && newElement.nextElementSibling.tagName === "UL") {
                    newElement.nextElementSibling.remove();
                }
                this.getLeaf(newElement, data.toNotebook);
            }
        }
    }

    private onLsHTML(data: { files: IFile[], box: string, path: string }) {
        let fileHTML = "";
        data.files.forEach((item: IFile) => {
            fileHTML += this.genFileHTML(item);
        });
        if (fileHTML === "") {
            return;
        }
        const liElement = this.element.querySelector(`ul[data-url="${data.box}"] li[data-path="${data.path}"]`);
        let nextElement = liElement.nextElementSibling;
        if (nextElement && nextElement.tagName === "UL") {
            // 文件展开时，刷新
            nextElement.remove();
        }
        liElement.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
        liElement.insertAdjacentHTML("afterend", `<ul class="file-tree__sliderDown">${fileHTML}</ul>`);
        nextElement = liElement.nextElementSibling;
        setTimeout(() => {
            nextElement.setAttribute("style", `height:${nextElement.childElementCount * liElement.clientHeight}px;`);
            setTimeout(() => {
                this.element.querySelectorAll(".file-tree__sliderDown").forEach(item => {
                    item.classList.remove("file-tree__sliderDown");
                    item.removeAttribute("style");
                });
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
                    path: item.path,
                    sort: window.siyuan.config.fileTree.sort
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
        liElement.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
        liElement.insertAdjacentHTML("afterend", `<ul>${fileHTML}</ul>`);
        this.setCurrent(this.element.querySelector(`ul[data-url="${data.box}"] li[data-path="${filePath}"]`));
    }

    private setCurrent(target: HTMLElement) {
        if (!target) {
            return;
        }
        this.element.querySelectorAll("li").forEach((liItem) => {
            liItem.classList.remove("b3-list-item--focus");
        });
        target.classList.add("b3-list-item--focus");
        const titleHeight = this.actionsElement.clientHeight;
        if (target.offsetTop - titleHeight < this.element.scrollTop) {
            this.element.scrollTop = target.offsetTop - titleHeight;
        } else if (target.offsetTop - this.element.clientHeight - titleHeight + target.clientHeight > this.element.scrollTop) {
            this.element.scrollTop = target.offsetTop - this.element.clientHeight - titleHeight + target.clientHeight;
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
            sort: window.siyuan.config.fileTree.sort,
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
                path: currentPath,
                sort: window.siyuan.config.fileTree.sort
            }, response => {
                this.onLsSelect(response.data, filePath);
            });
        }
    }

    private genFileHTML = (item: IFile) => {
        let countHTML = "";
        if (item.count && item.count > 0) {
            countHTML = `<span class="popover__block counter b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.blockRef}">${item.count}</span>`;
        }
        return `<li title="${getDisplayName(item.name, true, true)} ${item.hSize}${item.bookmark ? "\n" + window.siyuan.languages.bookmark + " " + item.bookmark : ""}${item.name1 ? "\n" + window.siyuan.languages.name + " " + item.name1 : ""}${item.alias ? "\n" + window.siyuan.languages.alias + " " + item.alias : ""}${item.memo ? "\n" + window.siyuan.languages.memo + " " + item.memo : ""}${item.subFileCount !== 0 ? window.siyuan.languages.includeSubFile.replace("x", item.subFileCount) : ""}\n${window.siyuan.languages.modifiedAt} ${item.hMtime}\n${window.siyuan.languages.createdAt} ${item.hCtime}" 
data-node-id="${item.id}" data-name="${Lute.EscapeHTMLStr(item.name)}" draggable="true" data-count="${item.subFileCount}" 
data-type="navigation-file" 
class="b3-list-item b3-list-item--hide-action" data-path="${item.path}">
    <span style="padding-left: ${(item.path.split("/").length - 1) * 16}px" class="b3-list-item__toggle b3-list-item__toggle--hl${item.subFileCount === 0 ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    <span class="b3-list-item__icon b3-tooltips b3-tooltips__n" aria-label="${window.siyuan.languages.changeIcon}">${unicode2Emoji(item.icon || Constants.SIYUAN_IMAGE_FILE)}</span>
    <span class="b3-list-item__text">${getDisplayName(item.name, true, true)}</span>
    <span data-type="more-file" class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action b3-tooltips b3-tooltips__nw${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.newFile}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>
    ${countHTML}
</li>`;
    };

    private initMoreMenu() {
        window.siyuan.menus.menu.remove();
        const clickEvent = (sort: number) => {
            window.siyuan.config.fileTree.sort = sort;
            fetchPost("/api/setting/setFiletree", {
                sort: window.siyuan.config.fileTree.sort,
                alwaysSelectOpenedFile: window.siyuan.config.fileTree.alwaysSelectOpenedFile,
                refCreateSavePath: window.siyuan.config.fileTree.refCreateSavePath,
                createDocNameTemplate: window.siyuan.config.fileTree.createDocNameTemplate,
                openFilesUseCurrentTab: window.siyuan.config.fileTree.openFilesUseCurrentTab,
                maxListCount: window.siyuan.config.fileTree.maxListCount,
            }, () => {
                setNoteBook(() => {
                    this.init(false);
                });
            });
        };
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
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconSort",
                label: window.siyuan.languages.sort,
                type: "submenu",
                submenu: [{
                    icon: window.siyuan.config.fileTree.sort === 0 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.fileNameASC,
                    click: () => {
                        clickEvent(0);
                    }
                }, {
                    icon: window.siyuan.config.fileTree.sort === 1 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.fileNameDESC,
                    click: () => {
                        clickEvent(1);
                    }
                }, {type: "separator"}, {
                    icon: window.siyuan.config.fileTree.sort === 4 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.fileNameNatASC,
                    click: () => {
                        clickEvent(4);
                    }
                }, {
                    icon: window.siyuan.config.fileTree.sort === 5 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.fileNameNatDESC,
                    click: () => {
                        clickEvent(5);
                    }
                }, {type: "separator"}, {
                    icon: window.siyuan.config.fileTree.sort === 9 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.createdASC,
                    click: () => {
                        clickEvent(9);
                    }
                }, {
                    icon: window.siyuan.config.fileTree.sort === 10 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.createdDESC,
                    click: () => {
                        clickEvent(10);
                    }
                }, {
                    icon: window.siyuan.config.fileTree.sort === 2 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.modifiedASC,
                    click: () => {
                        clickEvent(2);
                    }
                }, {
                    icon: window.siyuan.config.fileTree.sort === 3 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.modifiedDESC,
                    click: () => {
                        clickEvent(3);
                    }
                }, {type: "separator"}, {
                    icon: window.siyuan.config.fileTree.sort === 7 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.refCountASC,
                    click: () => {
                        clickEvent(7);
                    }
                }, {
                    icon: window.siyuan.config.fileTree.sort === 8 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.refCountDESC,
                    click: () => {
                        clickEvent(8);
                    }
                }, {type: "separator"}, {
                    icon: window.siyuan.config.fileTree.sort === 6 ? "iconSelect" : undefined,
                    label: window.siyuan.languages.customSort,
                    click: () => {
                        clickEvent(6);
                    }
                }]
            }).element);
        }
        return window.siyuan.menus.menu;
    }
}
