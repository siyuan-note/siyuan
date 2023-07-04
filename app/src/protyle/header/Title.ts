import {
    focusBlock, focusByOffset,
    focusByRange, focusByWbr,
    getEditorRange, getSelectionOffset,
} from "../util/selection";
import {fetchPost} from "../../util/fetch";
import {replaceFileName, validateName} from "../../editor/rename";
import {MenuItem} from "../../menus/Menu";
import {
    openFileAttr,
} from "../../menus/commonMenuItem";
/// #if !BROWSER
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {Constants} from "../../constants";
import {matchHotKey} from "../util/hotKey";
import {readText, writeText} from "../util/compatibility";
import * as dayjs from "dayjs";
import {setPanelFocus} from "../../layout/util";
import {openFileById, updatePanelByEditor} from "../../editor/util";
import {setTitle} from "../../dialog/processSystem";
import {getNoContainerElement} from "../wysiwyg/getBlock";
import {commonHotkey} from "../wysiwyg/commonHotkey";
import {code160to32} from "../util/code160to32";
import {genEmptyElement} from "../../block/util";
import {transaction} from "../wysiwyg/transaction";
import {hideTooltip} from "../../dialog/tooltip";
import {quickMakeCard} from "../../card/makeCard";
import {commonClick} from "../wysiwyg/commonClick";
import {openTitleMenu} from "./openTitleMenu";

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
        // 标题内需要一个空格，避免首次加载出现`请输入文档名`干扰
        this.element.innerHTML = `<span aria-label="${window.siyuan.languages.gutterTip2}" class="protyle-title__icon" data-type="a" data-position="right"><svg><use xlink:href="#iconFile"></use></svg></span>
<div contenteditable="true" data-position="center" spellcheck="${window.siyuan.config.editor.spellcheck}" class="protyle-title__input" data-tip="${window.siyuan.languages._kernel[16]}"> </div><div class="protyle-attr"></div>`;
        this.editElement = this.element.querySelector(".protyle-title__input");
        this.editElement.addEventListener("paste", (event: ClipboardEvent) => {
            event.stopPropagation();
            event.preventDefault();
            document.execCommand("insertText", false, replaceFileName(event.clipboardData.getData("text/plain")));
            this.rename(protyle);
        });
        this.editElement.addEventListener("click", () => {
            if (protyle.model) {
                setPanelFocus(protyle.model.element.parentElement.parentElement);
                updatePanelByEditor({
                    protyle: protyle,
                    focus: false,
                    pushBackStack: false,
                    reload: false,
                    resize: false,
                });
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
            // https://ld246.com/article/1661911210429
            event.stopPropagation();
            event.preventDefault();
        });
        this.editElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing) {
                return;
            }

            if (commonHotkey(protyle, event)) {
                return true;
            }
            if (matchHotKey(window.siyuan.config.keymap.general.enterBack.custom, event)) {
                const ids = protyle.path.split("/");
                if (ids.length > 2) {
                    openFileById({
                        app: protyle.app,
                        id: ids[ids.length - 2],
                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]
                    });
                }
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            /// #if !BROWSER
            if (matchHotKey(window.siyuan.config.keymap.editor.general.undo.custom, event)) {
                getCurrentWindow().webContents.undo();
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (matchHotKey(window.siyuan.config.keymap.editor.general.redo.custom, event)) {
                getCurrentWindow().webContents.redo();
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            /// #endif
            if (event.key === "ArrowDown") {
                const noContainerElement = getNoContainerElement(protyle.wysiwyg.element.firstElementChild);
                // https://github.com/siyuan-note/siyuan/issues/4923
                if (noContainerElement) {
                    focusBlock(noContainerElement, protyle.wysiwyg.element);
                }
                event.preventDefault();
                event.stopPropagation();
            } else if (event.key === "Enter") {
                const newId = Lute.NewNodeID();
                const newElement = genEmptyElement(false, true, newId);
                protyle.wysiwyg.element.insertAdjacentElement("afterbegin", newElement);
                focusByWbr(newElement, protyle.toolbar.range || getEditorRange(newElement));
                transaction(protyle, [{
                    action: "insert",
                    data: newElement.outerHTML,
                    id: newId,
                    parentID: protyle.block.parentID
                }], [{
                    action: "delete",
                    id: newId,
                }]);
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
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.quickMakeCard.custom, event)) {
                quickMakeCard(protyle, [this.element]);
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey("⌘A", event)) {
                getEditorRange(this.editElement).selectNodeContents(this.editElement);
                event.preventDefault();
                event.stopPropagation();
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.copyBlockRef.custom, event)) {
                fetchPost("/api/block/getRefText", {id: protyle.block.rootID}, (response) => {
                    writeText(`((${protyle.block.rootID} '${response.data}'))`);
                });
                event.preventDefault();
                event.stopPropagation();
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.copyID.custom, event)) {
                writeText(protyle.block.rootID);
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
                openTitleMenu(protyle, {x: iconRect.left, y: iconRect.bottom});
            }
        });
        this.element.addEventListener("contextmenu", (event) => {
            if (getSelection().rangeCount === 0) {
                openTitleMenu(protyle, {x: event.clientX, y: event.clientY});
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
                click: async () => {
                    focusByRange(getEditorRange(this.editElement));
                    // 不能使用 execCommand https://github.com/siyuan-note/siyuan/issues/7045
                    const text = await readText();
                    document.execCommand("insertText", false, replaceFileName(text));
                    this.rename(protyle);
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
            window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
        });
        this.element.querySelector(".protyle-attr").addEventListener("click", (event: MouseEvent & {
            target: HTMLElement
        }) => {
            fetchPost("/api/block/getDocInfo", {
                id: protyle.block.rootID
            }, (response) => {
                commonClick(event, protyle, response.data.ial);
            });
        });
    }

    private rename(protyle: IProtyle) {
        clearTimeout(this.timeout);
        if (!validateName(this.editElement.textContent, this.editElement)) {
            // 字数过长会导致滚动
            const offset = getSelectionOffset(this.editElement);
            this.setTitle(this.editElement.textContent.substring(0, Constants.SIZE_TITLE));
            focusByOffset(this.editElement, offset.start, offset.end);
            return false;
        }
        hideTooltip();
        this.timeout = window.setTimeout(() => {
            const fileName = replaceFileName(this.editElement.textContent);
            fetchPost("/api/filetree/renameDoc", {
                notebook: protyle.notebookId,
                path: protyle.path,
                title: fileName,
            });
            this.setTitle(fileName);
            setTitle(fileName);
        }, Constants.TIMEOUT_INPUT);
    }


    public setTitle(title: string) {
        if (code160to32(title) !== code160to32(this.editElement.textContent)) {
            this.editElement.textContent = title === "Untitled" ? "" : title;
        }
    }

    public render(protyle: IProtyle, response: IWebSocketData) {
        if (this.editElement.getAttribute("data-render") === "true") {
            return false;
        }
        this.element.setAttribute("data-node-id", protyle.block.rootID);
        if (response.data.ial["custom-riff-decks"]) {
            this.element.setAttribute("custom-riff-decks", response.data.ial["custom-riff-decks"]);
        }
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
    }
}
