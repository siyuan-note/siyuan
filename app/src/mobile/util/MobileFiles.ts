import {hasTopClosestByTag} from "../../protyle/util/hasClosest";
import {escapeHtml} from "../../util/escape";
import {Model} from "../../layout/Model";
import {Constants} from "../../constants";
import {getDisplayName, pathPosix, setNoteBook} from "../../util/pathName";
import {newFile} from "../../util/newFile";
import {initFileMenu, initNavigationMenu} from "../../menus/navigation";
import {showMessage} from "../../dialog/message";
import {fetchPost} from "../../util/fetch";
import {genUUID} from "../../util/genID";
import {openMobileFileById} from "../editor";
import {unicode2Emoji} from "../../emoji";
import {newNotebook} from "../../util/mount";
import {setEmpty} from "./setEmpty";
import {confirmDialog} from "../../dialog/confirmDialog";
import {MenuItem} from "../../menus/Menu";

export class MobileFiles extends Model {
    public element: HTMLElement;
    private actionsElement: HTMLElement;
    private closeElement: HTMLElement;

    constructor() {
        super({
            id: genUUID(),
            type: "filetree",
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
        filesElement.innerHTML = `<div class="toolbar">
    <div class="fn__space"></div>
    <div class="toolbar__text">${window.siyuan.languages.fileTree}</div>
    <div class="fn__flex-1 fn__space"></div>
    <svg data-type="newNotebook" class="toolbar__icon"><use xlink:href="#iconFilesRoot"></use></svg>
    <svg data-type="refresh" class="toolbar__icon"><use xlink:href="#iconRefresh"></use></svg>
    <svg data-type="focus" class="toolbar__icon"><use xlink:href="#iconFocus"></use></svg>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
    <svg data-type="sort" class="toolbar__icon${window.siyuan.config.readonly ? " fn__none" : ""}"><use xlink:href="#iconSort"></use></svg>
</div>
<div class="fn__flex-1" data-type="navigation"></div>
<ul class="b3-list b3-list--background fn__flex-column" style="min-height: auto;transition: var(--b3-transition)">
    <li class="b3-list-item" data-type="toggle">
        <span class="b3-list-item__toggle">
            <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
        </span>
        <span class="b3-list-item__text">${window.siyuan.languages.closeNotebook}</span>
    </li>
    <ul class="fn__none fn__flex-1"></ul>
</ul>`;
        this.actionsElement = filesElement.firstElementChild as HTMLElement;
        this.element = this.actionsElement.nextElementSibling as HTMLElement;
        this.closeElement = this.element.nextElementSibling as HTMLElement;
        filesElement.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.actionsElement)) {
                const type = target.getAttribute("data-type");
                if (type === "refresh") {
                    if (!target.getAttribute("disabled")) {
                        target.setAttribute("disabled", "disabled");
                        const notebooks: string[] = [];
                        Array.from(this.element.children).forEach(item => {
                            notebooks.push(item.getAttribute("data-url"));
                        });
                        fetchPost("/api/filetree/refreshFiletree", {}, () => {
                            target.removeAttribute("disabled");
                            this.init(false);
                        });
                    }
                    event.preventDefault();
                    break;
                } else if (type === "focus") {
                    if (window.siyuan.mobileEditor) {
                        this.selectItem(window.siyuan.mobileEditor.protyle.notebookId, window.siyuan.mobileEditor.protyle.path);
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
                    this.genSort(event);
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
                    if (this.closeElement.classList.contains("fn__flex-1")) {
                        this.closeElement.lastElementChild.classList.add("fn__none");
                        this.closeElement.classList.remove("fn__flex-1");
                        target.querySelector("svg").classList.remove("b3-list-item__arrow--open");
                    } else {
                        this.closeElement.lastElementChild.classList.remove("fn__none");
                        this.closeElement.classList.add("fn__flex-1");
                        target.querySelector("svg").classList.add("b3-list-item__arrow--open");
                    }
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
                    const x = (event instanceof TouchEvent) ? event.touches[0].clientX : event.clientX;
                    const y = (event instanceof TouchEvent) ? event.touches[0].clientY : event.clientY;
                    const ulElement = hasTopClosestByTag(target, "UL");
                    if (ulElement) {
                        const notebookId = ulElement.getAttribute("data-url");
                        if (!window.siyuan.config.readonly) {
                            if (type === "new") {
                                newFile(notebookId, pathString, true);
                            } else if (type === "more-root") {
                                initNavigationMenu(target.parentElement).popup({x, y});
                            }
                        }
                        if (type === "more-file") {
                            initFileMenu(notebookId, pathString, target.parentElement.getAttribute("data-node-id"), target.parentElement.getAttribute("data-name")).popup({
                                x,
                                y
                            });
                        }
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.tagName === "LI") {
                    this.setCurrent(target);
                    if (target.getAttribute("data-type") === "navigation-file") {
                        openMobileFileById(target.getAttribute("data-node-id"));
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
    }

    private genSort(event: MouseEvent) {
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
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 0 ? "iconSelect" : undefined,
            label: window.siyuan.languages.fileNameASC,
            click: () => {
                clickEvent(0);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 1 ? "iconSelect" : undefined,
            label: window.siyuan.languages.fileNameDESC,
            click: () => {
                clickEvent(1);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            type: "separator"
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 4 ? "iconSelect" : undefined,
            label: window.siyuan.languages.fileNameNatASC,
            click: () => {
                clickEvent(4);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 5 ? "iconSelect" : undefined,
            label: window.siyuan.languages.fileNameNatDESC,
            click: () => {
                clickEvent(5);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            type: "separator"
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 9 ? "iconSelect" : undefined,
            label: window.siyuan.languages.createdASC,
            click: () => {
                clickEvent(9);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 10 ? "iconSelect" : undefined,
            label: window.siyuan.languages.createdDESC,
            click: () => {
                clickEvent(10);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 2 ? "iconSelect" : undefined,
            label: window.siyuan.languages.modifiedASC,
            click: () => {
                clickEvent(2);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 3 ? "iconSelect" : undefined,
            label: window.siyuan.languages.modifiedDESC,
            click: () => {
                clickEvent(3);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 7 ? "iconSelect" : undefined,
            label: window.siyuan.languages.refCountASC,
            click: () => {
                clickEvent(7);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 8 ? "iconSelect" : undefined,
            label: window.siyuan.languages.refCountDESC,
            click: () => {
                clickEvent(8);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: window.siyuan.config.fileTree.sort === 6 ? "iconSelect" : undefined,
            label: window.siyuan.languages.customSort,
            click: () => {
                clickEvent(6);
            }
        }).element);
        window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
    }

    private genNotebook(item: INotebook) {
        const emojiHTML = `<span class="b3-list-item__icon b3-tooltips b3-tooltips__e" aria-label="${window.siyuan.languages.changeIcon}">${unicode2Emoji(item.icon || Constants.SIYUAN_IMAGE_NOTE)}</span>`;
        if (item.closed) {
            return `<li data-type="open" data-url="${item.id}" class="b3-list-item">
    <span class="b3-list-item__toggle fn__hidden">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    <span class="b3-list-item__text">${escapeHtml(item.name)}</span>
    <span data-type="remove" data-url="${item.id}" class="b3-list-item__action${(window.siyuan.config.readonly) ? " fn__none" : ""}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
</li>`;
        } else {
            return `<ul class="b3-list b3-list--background" data-url="${item.id}">
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
        // 重新展开移动到的新文件夹
        if (newElement) {
            newElement.querySelector(".b3-list-item__toggle").classList.remove("fn__hidden");
            newElement.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
            if (newElement.nextElementSibling && newElement.nextElementSibling.tagName === "UL") {
                newElement.nextElementSibling.remove();
            }
            this.getLeaf(newElement, data.toNotebook);
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
                folderPath = pathPosix().dirname(folderPath);
            }
        }
        if (targetElement.tagName === "UL") {
            if (pathPosix().dirname(data.path) === "/") {
                targetElement = targetElement.firstElementChild as HTMLElement;
            } else {
                targetElement = undefined;
            }
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
            if (window.siyuan.mobileEditor) {
                fetchPost("/api/block/checkBlockExist", {id: window.siyuan.mobileEditor.protyle.block.rootID}, existResponse => {
                    if (!existResponse.data) {
                        setEmpty();
                    }
                });
            }
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
        }
        setNoteBook((notebooks: INotebook[])=> {
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
                openMobileFileById(Constants.HELP_START_PATH[window.siyuan.config.appearance.lang as "zh_CN" | "en_US"]);
            }
        });

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

    private getLeaf(liElement: Element, notebookId: string) {
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
            countHTML = `<span class="counter">${item.count}</span>`;
        }
        return `<li data-node-id="${item.id}" data-name="${Lute.EscapeHTMLStr(item.name)}" draggable="true" 
data-type="navigation-file" 
class="b3-list-item" data-path="${item.path}">
    <span style="padding-left: ${(item.path.split("/").length - 1) * 16}px" class="b3-list-item__toggle${item.subFileCount === 0 ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    <span class="b3-list-item__icon">${unicode2Emoji(item.icon || Constants.SIYUAN_IMAGE_FILE)}</span>
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
}
