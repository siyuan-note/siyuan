import {
    focusBlock,
    focusByRange,
    getEditorRange,
} from "../util/selection";
import {fetchPost} from "../../util/fetch";
import {replaceFileName, validateName} from "../../editor/rename";
import {MenuItem} from "../../menus/Menu";
import {
    copySubMenu,
    movePathToMenu,
    openFileAttr,
    openFileWechatNotify,
} from "../../menus/commonMenuItem";
import {Constants} from "../../constants";
import {hasClosestByClassName} from "../util/hasClosest";
import {matchHotKey} from "../util/hotKey";
import {updateHotkeyTip, writeText} from "../util/compatibility";
import {setPanelFocus} from "../../layout/util";
import {escapeHtml} from "../../util/escape";
import {deleteFile, openBacklink, openGraph, openOutline, updatePanelByEditor} from "../../editor/util";
import * as dayjs from "dayjs";
import {setTitle} from "../../dialog/processSystem";
import {getNoContainerElement} from "../wysiwyg/getBlock";
import {commonHotkey} from "../wysiwyg/commonHotkey";
import {setPosition} from "../../util/setPosition";
import {code160to32} from "../util/code160to32";

export class Title {
    public element: HTMLElement;
    public editElement: HTMLElement;
    private timeout: number;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.className = "protyle-title";
        if (window.siyuan.config.editor.displayBookmarkIcon) {
            this.element.classList.add("protyle-wysiwyg--attr");
        }
        this.element.innerHTML = `<span aria-label="${window.siyuan.languages.gutterTip2}" class="protyle-title__icon" data-type="a" data-position="right"><svg><use xlink:href="#iconFile"></use></svg></span>
<div contenteditable="true" spellcheck="false" class="protyle-title__input" data-tip="${window.siyuan.languages._kernel[16]}"></div><div class="protyle-attr"></div>`;
        this.editElement = this.element.querySelector(".protyle-title__input");
        this.editElement.addEventListener("paste", (event: ClipboardEvent) => {
            event.stopPropagation();
            event.preventDefault();
            const range = getEditorRange(this.editElement);
            range.deleteContents();
            range.insertNode(document.createTextNode(replaceFileName(event.clipboardData.getData("text/plain"))));
            range.collapse(false);
            this.rename(protyle);
        });
        this.editElement.addEventListener("click", () => {
            if (protyle.model) {
                setPanelFocus(protyle.model.element.parentElement.parentElement);
                updatePanelByEditor(protyle, false);
            }
            protyle.toolbar?.element.classList.add("fn__none");
        });
        this.editElement.addEventListener("input", (event: InputEvent) => {
            if (event.isComposing) {
                return;
            }
            this.rename(protyle);
        });
        this.editElement.addEventListener("compositionend", () => {
            this.rename(protyle);
        });
        this.editElement.addEventListener("drop", (event: DragEvent) => {
            if (event.dataTransfer.getData(Constants.SIYUAN_DROP_EDITOR)) {
                event.stopPropagation();
                event.preventDefault();
            }
        });
        this.editElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing) {
                return;
            }

            if (commonHotkey(protyle, event)) {
                return true;
            }

            if (event.key === "ArrowDown" || event.key === "Enter") {
                const noContainerElement = getNoContainerElement(protyle.wysiwyg.element.firstElementChild);
                // https://github.com/siyuan-note/siyuan/issues/4923
                if (noContainerElement) {
                    focusBlock(noContainerElement, protyle.wysiwyg.element);
                }
                event.preventDefault();
                event.stopPropagation();
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.attr.custom, event)) {
                fetchPost("/api/block/getDocInfo", {
                    id: protyle.block.rootID
                }, (response) => {
                    openFileAttr(response.data.ial, protyle.block.rootID);
                });
                event.preventDefault();
                event.stopPropagation();
            } else if (matchHotKey("⌘A", event)) {
                getEditorRange(this.editElement).selectNodeContents(this.editElement);
                event.preventDefault();
                event.stopPropagation();
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.copyBlockRef.custom, event)) {
                writeText(`((${protyle.block.rootID} '${this.editElement.textContent}'))`);
                event.preventDefault();
                event.stopPropagation();
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.copyBlockEmbed.custom, event)) {
                writeText(`{{select * from blocks where id='${protyle.block.rootID}'}}`);
                event.preventDefault();
                event.stopPropagation();
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.copyProtocol.custom, event)) {
                writeText(`siyuan://blocks/${protyle.block.rootID}`);
                event.preventDefault();
                event.stopPropagation();
            }
        });
        const iconElement = this.element.querySelector(".protyle-title__icon");
        iconElement.addEventListener("click", () => {
            if (window.siyuan.shiftIsPressed) {
                fetchPost("/api/block/getDocInfo", {
                    id: protyle.block.rootID
                }, (response) => {
                    openFileAttr(response.data.ial, protyle.block.rootID);
                });
            } else {
                const iconRect = iconElement.getBoundingClientRect();
                this.renderMenu(protyle, iconElement, {x: iconRect.left, y: iconRect.top + 14});
            }
        });
        this.element.addEventListener("contextmenu", (event) => {
            if (getSelection().rangeCount === 0) {
                this.renderMenu(protyle, iconElement, {x: event.clientX, y: event.clientY});
                return;
            }
            protyle.toolbar?.element.classList.add("fn__none");
            window.siyuan.menus.menu.remove();
            const range = getEditorRange(this.editElement);
            if (range.toString() !== "") {
                window.siyuan.menus.menu.append(new MenuItem({
                    icon: "iconCopy",
                    accelerator: "⌘C",
                    label: window.siyuan.languages.copy,
                    click: () => {
                        focusByRange(getEditorRange(this.editElement));
                        document.execCommand("copy");
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    icon: "iconCut",
                    accelerator: "⌘X",
                    label: window.siyuan.languages.cut,
                    click: () => {
                        focusByRange(getEditorRange(this.editElement));
                        document.execCommand("cut");
                        setTimeout(() => {
                            this.rename(protyle);
                        }, Constants.TIMEOUT_INPUT);
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    icon: "iconTrashcan",
                    accelerator: "⌫",
                    label: window.siyuan.languages.delete,
                    click: () => {
                        const range = getEditorRange(this.editElement);
                        range.extractContents();
                        focusByRange(range);
                        setTimeout(() => {
                            this.rename(protyle);
                        }, Constants.TIMEOUT_INPUT);
                    }
                }).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.paste,
                accelerator: "⌘V",
                click: () => {
                    focusByRange(getEditorRange(this.editElement));
                    document.execCommand("paste");
                    setTimeout(() => {
                        this.rename(protyle);
                    }, Constants.TIMEOUT_INPUT);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.selectAll,
                accelerator: "⌘A",
                click: () => {
                    range.selectNodeContents(this.editElement);
                    focusByRange(range);
                }
            }).element);
            window.siyuan.menus.menu.element.classList.remove("fn__none");
            setPosition(window.siyuan.menus.menu.element, event.clientX, event.clientY);
        });
        this.element.querySelector(".protyle-attr").addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            fetchPost("/api/block/getDocInfo", {
                id: protyle.block.rootID
            }, (response) => {
                const attrBookmarkElement = hasClosestByClassName(event.target, "protyle-attr--bookmark");
                if (attrBookmarkElement) {
                    openFileAttr(response.data.ial, protyle.block.rootID, "bookmark");
                    event.stopPropagation();
                    return;
                }

                const attrNameElement = hasClosestByClassName(event.target, "protyle-attr--name");
                if (attrNameElement) {
                    openFileAttr(response.data.ial, protyle.block.rootID, "name");
                    event.stopPropagation();
                    return;
                }

                const attrAliasElement = hasClosestByClassName(event.target, "protyle-attr--alias");
                if (attrAliasElement) {
                    openFileAttr(response.data.ial, protyle.block.rootID, "alias");
                    event.stopPropagation();
                    return;
                }

                const attrMemoElement = hasClosestByClassName(event.target, "protyle-attr--memo");
                if (attrMemoElement) {
                    openFileAttr(response.data.ial, protyle.block.rootID, "memo");
                    event.stopPropagation();
                    return;
                }
            });
        });
    }

    private rename(protyle: IProtyle) {
        clearTimeout(this.timeout);
        if (!validateName(this.editElement.textContent)) {
            return false;
        }
        this.timeout = window.setTimeout(() => {
            const fileName = replaceFileName(this.editElement.textContent);
            fetchPost("/api/filetree/renameDoc", {
                notebook: protyle.notebookId,
                path: protyle.path,
                title: fileName,
            });
            this.setTitle(fileName);
        }, Constants.TIMEOUT_INPUT);
    }

    private renderMenu(protyle: IProtyle, iconElement: Element, position: { x: number, y: number }) {
        fetchPost("/api/block/getDocInfo", {
            id: protyle.block.rootID
        }, (response) => {
            window.siyuan.menus.menu.remove();
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.copy,
                icon: "iconCopy",
                type: "submenu",
                submenu: copySubMenu(protyle.block.rootID, "")
            }).element);
            if (!window.siyuan.config.readonly) {
                window.siyuan.menus.menu.append(movePathToMenu(protyle.notebookId, protyle.path));
                window.siyuan.menus.menu.append(new MenuItem({
                    icon: "iconTrashcan",
                    label: window.siyuan.languages.delete,
                    click: () => {
                        deleteFile(protyle.notebookId, protyle.path, escapeHtml(this.editElement.textContent))
                    }
                }).element);
            }
            if (!window.siyuan.config.readonly) {
                window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.attr,
                    accelerator: window.siyuan.config.keymap.editor.general.attr.custom + "/" + updateHotkeyTip("⇧Click"),
                    click() {
                        openFileAttr(response.data.ial, protyle.block.rootID);
                    }
                }).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconAlignCenter",
                label: window.siyuan.languages.outline,
                accelerator: window.siyuan.config.keymap.editor.general.outline.custom,
                click: () => {
                    openOutline(protyle);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconLink",
                label: window.siyuan.languages.backlinks,
                accelerator: window.siyuan.config.keymap.editor.general.backlinks.custom,
                click: () => {
                    openBacklink(protyle);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconGraph",
                label: window.siyuan.languages.graphView,
                accelerator: window.siyuan.config.keymap.editor.general.graphView.custom,
                click: () => {
                    openGraph(protyle);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.wechatReminder,
                icon: "iconMp",
                click() {
                    openFileWechatNotify(protyle);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                type: "readonly",
                label: `${window.siyuan.languages.modifiedAt} ${dayjs(response.data.ial.updated).format("YYYY-MM-DD HH:mm:ss")}<br>
${window.siyuan.languages.createdAt} ${dayjs(response.data.ial.id.substr(0, 14)).format("YYYY-MM-DD HH:mm:ss")}`
            }).element);
            window.siyuan.menus.menu.popup(position);
        });
    }

    public setTitle(title: string) {
        if (code160to32(title) !== code160to32(this.editElement.textContent)) {
            this.editElement.textContent = title === "Untitled" ? "" : title;
        }
    }

    public render(protyle: IProtyle, refresh = false) {
        if (this.editElement.getAttribute("data-render") === "true" && !refresh) {
            return;
        }
        fetchPost("/api/block/getDocInfo", {
            id: protyle.block.rootID
        }, (response) => {
            setTitle(response.data.ial.title);
            protyle.background.render(response.data.ial, protyle.block.rootID);
            protyle.wysiwyg.renderCustom(response.data.ial);
            this.editElement.setAttribute("data-render", "true");
            this.setTitle(response.data.ial.title);
            let nodeAttrHTML = "";
            if (response.data.ial.bookmark) {
                nodeAttrHTML += `<div class="protyle-attr--bookmark">${Lute.EscapeHTMLStr(response.data.ial.bookmark)}</div>`;
            }
            if (response.data.ial.name) {
                nodeAttrHTML += `<div class="protyle-attr--name"><svg><use xlink:href="#iconN"></use></svg>${Lute.EscapeHTMLStr(response.data.ial.name)}</div>`;
            }
            if (response.data.ial.alias) {
                nodeAttrHTML += `<div class="protyle-attr--alias"><svg><use xlink:href="#iconA"></use></svg>${Lute.EscapeHTMLStr(response.data.ial.alias)}</div>`;
            }
            if (response.data.ial.memo) {
                nodeAttrHTML += `<div class="protyle-attr--memo b3-tooltips b3-tooltips__sw" aria-label="${Lute.EscapeHTMLStr(response.data.ial.memo)}"><svg><use xlink:href="#iconM"></use></svg></div>`;
            }
            this.element.querySelector(".protyle-attr").innerHTML = nodeAttrHTML;
            if (response.data.refCount !== 0) {
                this.element.querySelector(".protyle-attr").insertAdjacentHTML("beforeend", `<div class="protyle-attr--refcount popover__block" data-defids='${JSON.stringify([protyle.block.rootID])}' data-id='${JSON.stringify(response.data.refIDs)}'>${response.data.refCount}</div>`);
            }
            // 存在设置新建文档名模板，不能使用 Untitled 进行判断，https://ld246.com/article/1649301009888
            if (new Date().getTime() - dayjs(response.data.id.split("-")[0]).toDate().getTime() < 2000) {
                const range = this.editElement.ownerDocument.createRange();
                range.selectNodeContents(this.editElement);
                focusByRange(range);
            }
        });
    }
}
