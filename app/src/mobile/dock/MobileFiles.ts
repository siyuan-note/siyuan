import {hasClosestByClassName, hasClosestByTag, hasTopClosestByTag} from "../../protyle/util/hasClosest";
import {escapeHtml} from "../../util/escape";
import {Model} from "../../layout/Model";
import {Constants} from "../../constants";
import {getDisplayName, pathPosix, setNoteBook} from "../../util/pathName";
import {initFileMenu, initNavigationMenu, sortMenu} from "../../menus/navigation";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {genUUID} from "../../util/genID";
import {openMobileFileById} from "../editor";
import {unicode2Emoji} from "../../emoji";
import {mountHelp, newNotebook} from "../../util/mount";
import {newFile} from "../../util/newFile";
import {MenuItem} from "../../menus/Menu";
import {App} from "../../index";
import {refreshFileTree} from "../../dialog/processSystem";
import {setStorageVal} from "../../protyle/util/compatibility";

export class MobileFiles extends Model {
    public element: HTMLElement;
    private actionsElement: HTMLElement;
    private closeElement: HTMLElement;

    constructor(app: App) {
        super({
            app,
            id: genUUID(),
            type: "filetree",
            msgCallback(data) {
                if (data) {
                    switch (data.cmd) {
                        case "moveDoc":
                            this.onMove(data.data);
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
                        case "create":
                            if (data.data.listDocTree) {
                                this.selectItem(data.data.box.id, data.data.path);
                            } else {
                                this.updateItemArrow(data.data.box.id, data.data.path);
                            }
                            break;
                        case "createdailynote":
                        case "heading2doc":
                        case "li2doc":
                            this.selectItem(data.data.box.id, data.data.path);
                            break;
                        case "renamenotebook":
                            this.element.querySelector(`[data-url="${data.data.box}"] .b3-list-item__text`).innerHTML = data.data.name;
                            break;
                        case "rename":
                            this.onRename(data.data);
                            break;
                    }
                }
            },
        });
        const filesElement = document.querySelector('#sidebar [data-type="sidebar-file"]');
        filesElement.innerHTML = `<div class="toolbar toolbar--border toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">${window.siyuan.languages.fileTree}</div>
    <div class="fn__flex-1 fn__space"></div>
    <svg data-type="newNotebook" class="toolbar__icon"><use xlink:href="#iconFilesRoot"></use></svg>
    <svg data-type="refresh" class="toolbar__icon"><use xlink:href="#iconRefresh"></use></svg>
    <svg data-type="focus" class="toolbar__icon"><use xlink:href="#iconFocus"></use></svg>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
    <svg data-type="sort" class="toolbar__icon${window.siyuan.config.readonly ? " fn__none" : ""}"><use xlink:href="#iconSort"></use></svg>
</div>
<div class="fn__flex-1"></div>
<ul class="b3-list b3-list--background fn__flex-column" style="min-height: auto;height:42px;transition: height .2s cubic-bezier(0, 0, .2, 1) 0ms">
    <li class="b3-list-item" data-type="toggle">
        <span class="b3-list-item__toggle">
            <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
        </span>
        <span class="b3-list-item__text">${window.siyuan.languages.closeNotebook}</span>
        <span class="counter" style="cursor: auto"></span>
    </li>
    <ul class="fn__none fn__flex-1"></ul>
</ul>`;
        this.actionsElement = filesElement.firstElementChild as HTMLElement;
        this.element = this.actionsElement.nextElementSibling as HTMLElement;
        this.closeElement = this.element.nextElementSibling as HTMLElement;
        filesElement.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.actionsElement)) {
                if (target.classList.contains("b3-list-item__icon")) {
                    target = target.previousElementSibling as HTMLElement;
                }
                const type = target.getAttribute("data-type");
                if (type === "refresh") {
                    if (!target.getAttribute("disabled")) {
                        target.setAttribute("disabled", "disabled");
                        const notebooks: string[] = [];
                        Array.from(this.element.children).forEach(item => {
                            notebooks.push(item.getAttribute("data-url"));
                        });
                        refreshFileTree(() => {
                            target.removeAttribute("disabled");
                            this.init(false);
                        });
                    }
                    event.preventDefault();
                    break;
                } else if (type === "focus") {
                    if (window.siyuan.mobile.editor) {
                        this.selectItem(window.siyuan.mobile.editor.protyle.notebookId, window.siyuan.mobile.editor.protyle.path);
                    }
                    event.preventDefault();
                    break;
                } else if (type === "newNotebook") {
                    newNotebook();
                } else if (type === "collapse") {
                    Array.from(this.element.children).forEach(item => {
                        const liElement = item.firstElementChild;
                        const toggleElement = liElement.querySelector(".b3-list-item__arrow");
                        if (toggleElement.classList.contains("b3-list-item__arrow--open")) {
                            toggleElement.classList.remove("b3-list-item__arrow--open");
                            liElement.nextElementSibling.remove();
                        }
                    });
                    event.preventDefault();
                    break;
                } else if (type === "sort") {
                    this.genSort();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("b3-list-item__toggle") && !target.classList.contains("fn__hidden") && target.parentElement.getAttribute("data-type") !== "toggle") {
                    const ulElement = hasTopClosestByTag(target, "UL");
                    if (ulElement) {
                        const notebookId = ulElement.getAttribute("data-url");
                        this.getLeaf(target.parentElement, notebookId);
                        this.setCurrent(target.parentElement);
                        window.siyuan.menus.menu.remove();
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "toggle") {
                    const svgElement = target.querySelector("svg");
                    if (svgElement.classList.contains("b3-list-item__arrow--open")) {
                        this.closeElement.style.height = "42px";
                        svgElement.classList.remove("b3-list-item__arrow--open");
                        this.closeElement.lastElementChild.classList.add("fn__none");
                    } else {
                        this.closeElement.style.height = "40%";
                        svgElement.classList.add("b3-list-item__arrow--open");
                        this.closeElement.lastElementChild.classList.remove("fn__none");
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "open") {
                    fetchPost("/api/notebook/openNotebook", {
                        notebook: target.getAttribute("data-url")
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (target.classList.contains("b3-list-item__action")) {
                    const type = target.getAttribute("data-type");
                    const pathString = target.parentElement.getAttribute("data-path");
                    const ulElement = hasTopClosestByTag(target, "UL");
                    if (ulElement) {
                        const notebookId = ulElement.getAttribute("data-url");
                        if (!window.siyuan.config.readonly) {
                            if (type === "new") {
                                newFile({
                                    app,
                                    notebookId,
                                    currentPath: pathString,
                                    useSavePath: false,
                                    listDocTree: true,
                                });
                            } else if (type === "more-root") {
                                initNavigationMenu(app, target.parentElement);
                                window.siyuan.menus.menu.fullscreen("bottom");
                            } else if (type === "addLocal") {
                                fetchPost("/api/filetree/moveLocalShorthands", {
                                    "notebook": notebookId
                                });
                                this.element.querySelectorAll('[data-type="addLocal"]').forEach(item => {
                                    item.remove();
                                });
                            }
                        }
                        if (type === "more-file") {
                            initFileMenu(app, notebookId, pathString, target.parentElement);
                            window.siyuan.menus.menu.fullscreen("bottom");
                        }
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.tagName === "LI") {
                    this.setCurrent(target);
                    if (target.getAttribute("data-type") === "navigation-file") {
                        openMobileFileById(app, target.getAttribute("data-node-id"), [Constants.CB_GET_SCROLL]);
                    } else if (target.getAttribute("data-type") === "navigation-root") {
                        const ulElement = hasTopClosestByTag(target, "UL");
                        if (ulElement) {
                            const notebookId = ulElement.getAttribute("data-url");
                            this.getLeaf(target, notebookId);
                        }
                    }
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        this.init();
        if (window.siyuan.config.openHelp) {
            mountHelp();
        }
    }

    private genSort() {
        window.siyuan.menus.menu.remove();
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
        subMenu.forEach((item) => {
            window.siyuan.menus.menu.append(new MenuItem(item).element);
        });
        window.siyuan.menus.menu.fullscreen("bottom");
    }

    private updateItemArrow(notebookId: string, filePath: string) {
        const treeElement = this.element.querySelector(`[data-url="${notebookId}"]`);
        if (!treeElement) {
            return;
        }
        let currentPath = filePath;
        let liElement;
        while (!liElement) {
            liElement = treeElement.querySelector(`[data-path="${currentPath}"]`);
            if (!liElement) {
                const dirname = pathPosix().dirname(currentPath);
                if (dirname === "/") {
                    if (treeElement.firstElementChild.querySelector(".b3-list-item__arrow--open")) {
                        this.getLeaf(treeElement.firstElementChild, notebookId, true);
                    }
                    break;
                } else {
                    currentPath = dirname + ".sy";
                }
            } else {
                const hiddenElement = liElement.querySelector(".fn__hidden");
                if (hiddenElement) {
                    hiddenElement.classList.remove("fn__hidden");
                } else {
                    this.getLeaf(liElement, notebookId, true);
                }
                break;
            }
        }
    }

    private genNotebook(item: INotebook) {
        const emojiHTML = `<span class="b3-list-item__icon b3-tooltips b3-tooltips__e" aria-label="${window.siyuan.languages.changeIcon}">${unicode2Emoji(item.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].note)}</span>`;
        if (item.closed) {
            return `<li data-url="${item.id}" class="b3-list-item">
    <span class="b3-list-item__toggle fn__hidden">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    <span class="b3-list-item__text">${escapeHtml(item.name)}</span>
    <span data-type="open" data-url="${item.id}" class="b3-list-item__action${(window.siyuan.config.readonly) ? " fn__none" : ""}">
        <svg><use xlink:href="#iconOpen"></use></svg>
    </span>
</li>`;
        } else {
            return `<ul class="b3-list b3-list--background" data-url="${item.id}" data-sortmode="${item.sortMode}">
<li class="b3-list-item" data-type="navigation-root" data-path="/">
    <span class="b3-list-item__toggle${item.closed ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    <span class="b3-list-item__text${item.closed ? " ft__on-surface" : ""}">${escapeHtml(item.name)}</span>
    <span data-type="more-root" class="b3-list-item__action${(window.siyuan.config.readonly || item.closed) ? " fn__none" : ""}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action${(window.siyuan.config.readonly || item.closed) ? " fn__none" : ""}">
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
            this.closeElement.classList.remove("fn__none");
        } else {
            this.closeElement.classList.add("fn__none");
        }
        window.siyuan.storage[Constants.LOCAL_FILESPATHS].forEach((item: IFilesPath) => {
            item.openPaths.forEach((openPath) => {
                this.selectItem(item.notebookId, openPath, undefined, false, false);
            });
        });
        if (!init) {
            return;
        }
        const svgElement = this.closeElement.querySelector("svg");
        if (html !== "") {
            this.closeElement.style.height = "42px";
            svgElement.classList.remove("b3-list-item__arrow--open");
            this.closeElement.lastElementChild.classList.add("fn__none");
        } else {
            this.closeElement.style.height = "40%";
            svgElement.classList.add("b3-list-item__arrow--open");
            this.closeElement.lastElementChild.classList.remove("fn__none");
        }
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
                    const emojiElement = sourceElement.parentElement.previousElementSibling.querySelector(".b3-list-item__icon");
                    if (emojiElement.innerHTML === unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].folder)) {
                        emojiElement.innerHTML = unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].file);
                    }
                }
                sourceElement.parentElement.remove();
            } else {
                sourceElement.remove();
            }
        } else {
            const parentElement = this.element.querySelector(`ul[data-url="${data.fromNotebook}"] li[data-path="${pathPosix().dirname(data.fromPath)}.sy"]`) as HTMLElement;
            if (parentElement && parentElement.getAttribute("data-count") === "1") {
                parentElement.querySelector(".b3-list-item__toggle").classList.add("fn__hidden");
                parentElement.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
            }
        }
        const newElement = this.element.querySelector(`[data-url="${data.toNotebook}"] li[data-path="${data.toPath}"]`) as HTMLElement;
        // 重新展开移动到的新文件夹
        if (newElement) {
            const emojiElement = newElement.querySelector(".b3-list-item__icon");
            if (emojiElement.innerHTML === unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].file)) {
                emojiElement.innerHTML = unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].folder);
            }
            newElement.querySelector(".b3-list-item__toggle").classList.remove("fn__hidden");
            newElement.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
            if (newElement.nextElementSibling && newElement.nextElementSibling.tagName === "UL") {
                newElement.nextElementSibling.remove();
            }
            this.getLeaf(newElement, data.toNotebook);
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
                        this.closeElement.classList.remove("fn__none");
                    }
                }
            });
            if (Constants.CB_MOUNT_REMOVE === data.callback) {
                const removeElement = this.closeElement.querySelector(`li[data-url="${data.data.box}"]`);
                if (removeElement) {
                    removeElement.remove();
                    const counterElement = this.closeElement.querySelector(".counter");
                    counterElement.textContent = (parseInt(counterElement.textContent) - 1).toString();
                    if (counterElement.textContent === "0") {
                        this.closeElement.classList.add("fn__none");
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
                        if (emojiElement.innerHTML === unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].folder)) {
                            emojiElement.innerHTML = unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].file);
                        }
                    }
                    targetElement.parentElement.remove();
                } else {
                    targetElement.remove();
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

    private onMount(data: { data: { box: INotebook, existed?: boolean }, callback?: string }) {
        if (data.data.existed) {
            return;
        }
        const liElement = this.closeElement.querySelector(`li[data-url="${data.data.box.id}"]`) as HTMLElement;
        if (liElement) {
            liElement.remove();
            const counterElement = this.closeElement.querySelector(".counter");
            counterElement.textContent = (parseInt(counterElement.textContent) - 1).toString();
            if (counterElement.textContent === "0") {
                this.closeElement.classList.add("fn__none");
            }
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

    private onLsHTML(data: { files: IFile[], box: string, path: string }) {
        if (data.files.length === 0) {
            return;
        }
        const liElement = this.element.querySelector(`ul[data-url="${data.box}"] li[data-path="${data.path}"]`);
        if (!liElement) {
            return;
        }
        let fileHTML = "";
        data.files.forEach((item: IFile) => {
            fileHTML += this.genFileHTML(item);
        });
        let nextElement = liElement.nextElementSibling;
        if (nextElement && nextElement.tagName === "UL") {
            // 文件展开时，刷新
            const tempElement = document.createElement("template");
            tempElement.innerHTML = fileHTML;
            // 保持文件夹展开状态
            nextElement.querySelectorAll(":scope > .b3-list-item > .b3-list-item__toggle> .b3-list-item__arrow--open").forEach(item => {
                const openLiElement = hasClosestByClassName(item, "b3-list-item");
                if (openLiElement) {
                    const tempOpenLiElement = tempElement.content.querySelector(`.b3-list-item[data-node-id="${openLiElement.getAttribute("data-node-id")}"]`);
                    tempOpenLiElement.after(openLiElement.nextElementSibling);
                    tempOpenLiElement.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
                }
            });
            nextElement.innerHTML = tempElement.innerHTML;
            return;
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

    private async onLsSelect(data: {
        files: IFile[],
        box: string,
        path: string
    }, filePath: string, setStorage: boolean, isSetCurrent: boolean) {
        let fileHTML = "";
        data.files.forEach((item: IFile) => {
            fileHTML += this.genFileHTML(item);
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
        if (emojiElement.textContent === unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].file)) {
            emojiElement.textContent = unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].folder);
        }
        liElement.insertAdjacentHTML("afterend", `<ul>${fileHTML}</ul>`);
        let newLiElement;
        for (let i = 0; i < data.files.length; i++) {
            const item = data.files[i];
            if (filePath === item.path) {
                newLiElement = await this.selectItem(data.box, filePath, undefined, setStorage, isSetCurrent);
            } else if (filePath.startsWith(item.path.replace(".sy", ""))) {
                const response = await fetchSyncPost("/api/filetree/listDocsByPath", {
                    notebook: data.box,
                    path: item.path,
                    app: Constants.SIYUAN_APPID,
                });
                newLiElement = await this.selectItem(response.data.box, filePath, response.data, setStorage, isSetCurrent);
            }
        }
        if (isSetCurrent) {
            this.setCurrent(newLiElement);
        }
        return newLiElement;
    }

    public setCurrent(target: HTMLElement, isScroll = true) {
        if (!target) {
            return;
        }
        this.element.querySelectorAll("li.b3-list-item--focus").forEach((liItem) => {
            liItem.classList.remove("b3-list-item--focus");
        });
        target.classList.add("b3-list-item--focus");

        if (isScroll) {
            const elementRect = this.element.getBoundingClientRect();
            this.element.scrollTop = this.element.scrollTop + (target.getBoundingClientRect().top - (elementRect.top + elementRect.height / 2));
        }
    }

    public getLeaf(liElement: Element, notebookId: string, focusUpdate = false) {
        const toggleElement = liElement.querySelector(".b3-list-item__arrow");
        if (toggleElement.classList.contains("b3-list-item__arrow--open") && !focusUpdate) {
            toggleElement.classList.remove("b3-list-item__arrow--open");
            liElement.nextElementSibling?.remove();
            this.getOpenPaths();
            return;
        }
        fetchPost("/api/filetree/listDocsByPath", {
            notebook: notebookId,
            path: liElement.getAttribute("data-path"),
            app: Constants.SIYUAN_APPID,
        }, response => {
            if (response.data.path === "/" && response.data.files.length === 0) {
                newFile({
                    app: this.app,
                    notebookId,
                    currentPath: "/",
                    useSavePath: false,
                    listDocTree: true,
                });
                return;
            }
            this.onLsHTML(response.data);
            this.getOpenPaths();
        });
    }

    public async selectItem(notebookId: string, filePath: string, data?: {
        files: IFile[],
        box: string,
        path: string
    }, setStorage = true, isSetCurrent = true) {
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
            if (setStorage) {
                this.getOpenPaths();
            }
            if (isSetCurrent) {
                this.setCurrent(liElement);
            }
            return liElement;
        }

        if (data && data.path === currentPath) {
            liElement = await this.onLsSelect(data, filePath, setStorage, isSetCurrent);
        } else {
            const response = await fetchSyncPost("/api/filetree/listDocsByPath", {
                notebook: notebookId,
                path: currentPath,
                app: Constants.SIYUAN_APPID,
            });
            liElement = await this.onLsSelect(response.data, filePath, setStorage, isSetCurrent);
        }
        return liElement;
    }

    private getOpenPaths() {
        const filesPaths: IFilesPath[] = [];
        this.element.querySelectorAll(".b3-list[data-url]").forEach((item: HTMLElement) => {
            const notebookPaths: IFilesPath = {
                notebookId: item.getAttribute("data-url"),
                openPaths: []
            };
            item.querySelectorAll(".b3-list-item__arrow--open").forEach((openItem) => {
                const liElement = hasClosestByTag(openItem, "LI");
                if (liElement) {
                    notebookPaths.openPaths.push(liElement.getAttribute("data-path"));
                }
            });
            if (notebookPaths.openPaths.length > 0) {
                for (let i = 0; i < notebookPaths.openPaths.length; i++) {
                    for (let j = i + 1; j < notebookPaths.openPaths.length; j++) {
                        if (notebookPaths.openPaths[j].startsWith(notebookPaths.openPaths[i].replace(".sy", ""))) {
                            notebookPaths.openPaths.splice(i, 1);
                            j--;
                        }
                    }
                }
                notebookPaths.openPaths.forEach((openPath, index) => {
                    const nextPath = this.element.querySelector(`[data-url="${notebookPaths.notebookId}"] li[data-path="${openPath}"]`)?.nextElementSibling?.firstElementChild?.getAttribute("data-path");
                    if (nextPath) {
                        notebookPaths.openPaths[index] = nextPath;
                    }
                });
                filesPaths.push(notebookPaths);
            }
        });
        window.siyuan.storage[Constants.LOCAL_FILESPATHS] = filesPaths;
        setStorageVal(Constants.LOCAL_FILESPATHS, filesPaths);
    }

    private genFileHTML = (item: IFile) => {
        let countHTML = "";
        if (item.count && item.count > 0) {
            countHTML = `<span class="counter">${item.count}</span>`;
        }
        return `<li data-node-id="${item.id}" data-name="${Lute.EscapeHTMLStr(item.name)}" data-type="navigation-file" 
class="b3-list-item" data-path="${item.path}">
    <span style="padding-left: ${(item.path.split("/").length - 1) * 20}px" class="b3-list-item__toggle${item.subFileCount === 0 ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    <span class="b3-list-item__icon">${unicode2Emoji(item.icon || (item.subFileCount === 0 ? window.siyuan.storage[Constants.LOCAL_IMAGES].file : window.siyuan.storage[Constants.LOCAL_IMAGES].folder))}</span>
    <span class="b3-list-item__text">${getDisplayName(item.name, true, true)}</span>
    <span data-type="more-file" class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action b3-tooltips b3-tooltips__nw${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.newSubDoc}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>
    ${countHTML}
</li>`;
    };
}
