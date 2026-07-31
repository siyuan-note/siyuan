import {getIconByType} from "../../editor/getIcon";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {MenuItem} from "../../menus/Menu";
import {fullscreen, net2LocalAssets, updateReadonly} from "./action";
import {openFileAttr} from "../../menus/commonMenuItem";
import {setEditMode} from "../util/setEditMode";
import {RecordMedia, RecordMediaInputEndedError} from "../util/RecordMedia";
import {hideMessage, showMessage} from "../../dialog/message";
import {uploadFiles} from "../upload";
import {hasClosestBlock, hasTopClosestByClassName} from "../util/hasClosest";
import {needSubscribe} from "../../util/needSubscribe";
import {isMobile} from "../../util/functions";
import {zoomOut} from "../../menus/protyle";
import {focusByRange, getEditorRange} from "../util/selection";
/// #if !MOBILE
import {openFileById} from "../../editor/util";
import {saveLayout} from "../../layout/util";
/// #endif
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {onGet} from "../util/onGet";
import {hideElements} from "../ui/hideElements";
import {confirmDialog} from "../../dialog/confirmDialog";
import {reloadProtyle} from "../util/reload";
import {Menu} from "../../plugin/Menu";
import {getNoContainerElement} from "../wysiwyg/getBlock";
import {openTitleMenu} from "../header/openTitleMenu";
import {emitOpenMenu} from "../../plugin/EventBus";
import {isInAndroid, isInHarmony, isIPad, isMac, updateHotkeyTip} from "../util/compatibility";
import {isEncryptedBox} from "../../util/pathName";
import {resize} from "../util/resize";
import {listIndent, listOutdent} from "../wysiwyg/list";
import {improveBreadcrumbAppearance} from "../wysiwyg/renderBacklink";
import {getCloudURL} from "../../config/util/about";
import {escapeAriaLabel} from "../../util/escape";
import {refreshUndoButtons} from "../undo/globalUndo";
import {getAllEditor} from "../../layout/getAll";

export class Breadcrumb {
    public element: HTMLElement;
    private mediaRecorder: RecordMedia;
    private id: string;
    private messageId: string;
    private recordUploadMessageIds = new Map<File, string>();
    private pendingRecordFiles = new Set<File>();
    private uploadingRecordFiles = new Set<File>();
    private startingRecord = false;
    private stoppingRecord = false;
    private previousFocusElement: HTMLElement;
    private previousRange: Range;

    constructor(protyle: IProtyle) {
        const element = document.createElement("div");
        element.className = "protyle-breadcrumb";
        let padHTML = "";
        /// #if BROWSER && !MOBILE
        if (isIPad() || isInAndroid() || isInHarmony()) {
            padHTML = `<button class="block__icon fn__flex-center ariaLabel" disabled aria-label="${window.siyuan.languages.undo}" data-type="undo"><svg><use xlink:href="#iconUndo"></use></svg></button>
<button class="block__icon fn__flex-center ariaLabel" disabled aria-label="${window.siyuan.languages.redo}" data-type="redo"><svg><use xlink:href="#iconRedo"></use></svg></button>
<button class="block__icon fn__flex-center ariaLabel" disabled aria-label="${window.siyuan.languages.outdent}" data-type="outdent"><svg><use xlink:href="#iconOutdent"></use></svg></button>
<button class="block__icon fn__flex-center ariaLabel" disabled aria-label="${window.siyuan.languages.indent}" data-type="indent"><svg><use xlink:href="#iconIndent"></use></svg></button>`;
        }
        /// #endif
        element.innerHTML = `${isMobile() ?
            `<button class="protyle-breadcrumb__icon" data-type="mobile-menu">${window.siyuan.languages.breadcrumb}</button>` :
            '<div class="protyle-breadcrumb__bar"></div>'}
<span class="protyle-breadcrumb__space"></span>
<button class="protyle-breadcrumb__icon fn__none ariaLabel" aria-label="${updateHotkeyTip(window.siyuan.config.keymap.editor.general.exitFocus.custom)}" data-type="exit-focus">${window.siyuan.languages.exitFocus}</button>
${padHTML}
<button class="block__icon fn__flex-center ariaLabel${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.lockEdit}" data-type="readonly" data-subtype="unlock"><svg><use xlink:href="#iconUnlock"></use></svg></button>
<button class="block__icon fn__flex-center ariaLabel" data-type="doc" aria-label="${isMac() ? window.siyuan.languages.gutterTip2 : window.siyuan.languages.gutterTip2.replace("⇧", "Shift+")}"><svg><use xlink:href="#iconFile"></use></svg></button>
<button class="block__icon fn__flex-center ariaLabel" data-type="more" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></button>
<button class="block__icon fn__flex-center fn__none ariaLabel" data-type="context" aria-label="${window.siyuan.languages.context}"><svg><use xlink:href="#iconAlignCenter"></use></svg></button>`;
        this.element = element.firstElementChild as HTMLElement;
        element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            const arrowElement = target.closest(".protyle-breadcrumb__arrow");
            if (arrowElement && this.element.contains(arrowElement)) {
                const itemElement = arrowElement.previousElementSibling as HTMLElement;
                if (itemElement?.classList.contains("protyle-breadcrumb__item")) {
                    const targetRect = arrowElement.getBoundingClientRect();
                    this.openChildrenMenu(protyle, itemElement.getAttribute("data-node-id"), {
                        x: targetRect.left,
                        y: targetRect.bottom,
                        isLeft: false,
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }
            while (target && !target.isEqualNode(element)) {
                const id = target.getAttribute("data-node-id");
                const type = target.getAttribute("data-type");
                if (id) {
                    /// #if !MOBILE
                    if (protyle.options.render.breadcrumbDocName && window.siyuan.ctrlIsPressed) {
                        openFileById({
                            app: protyle.app,
                            id,
                            action: id === protyle.block.rootID ? [Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL]
                        });
                    } else {
                        zoomOut({protyle, id});
                    }
                    /// #endif
                    event.preventDefault();
                    break;
                } else if (type === "mobile-menu") {
                    this.genMobileMenu(protyle);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "doc") {
                    // 不使用 window.siyuan.shiftIsPressed ，否则窗口未激活时按 Shift 点击块标无法打开属性面板 https://github.com/siyuan-note/siyuan/issues/15075
                    if (event.shiftKey) {
                        const docInfoParam: IObject = {
                            id: protyle.block.rootID
                        };
                        if (isEncryptedBox(protyle.notebookId)) {
                            docInfoParam.notebook = protyle.notebookId;
                        }
                        fetchPost("/api/block/getDocInfo", docInfoParam, (response) => {
                            openFileAttr(response.data.ial, "bookmark", protyle);
                        });
                    } else {
                        const targetRect = target.getBoundingClientRect();
                        openTitleMenu(protyle, {x: targetRect.right, y: targetRect.bottom, isLeft: true}, Constants.MENU_FROM_TITLE_BREADCRUMB);
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "more") {
                    const targetRect = target.getBoundingClientRect();
                    this.showMenu(protyle, {
                        x: targetRect.right,
                        y: targetRect.bottom,
                        isLeft: true,
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "readonly") {
                    updateReadonly(target, protyle);
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "exit-focus") {
                    zoomOut({
                        protyle,
                        id: protyle.block.rootID,
                        focusId: protyle.block.id,
                        dataDocType: "NodeDocument",
                        callback: () => {
                            element.querySelector('[data-type="context"]').classList.add("block__icon--active");
                        }
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "context") {
                    event.stopPropagation();
                    event.preventDefault();
                    if (target.classList.contains("block__icon--active")) {
                        zoomOut({protyle, id: protyle.options.blockId});
                    } else {
                        const getDocParam: IObject = {
                            id: protyle.options.blockId,
                            mode: 3,
                            size: window.siyuan.config.editor.dynamicLoadBlocks,
                        };
                        if (isEncryptedBox(protyle.notebookId)) {
                            getDocParam.notebook = protyle.notebookId;
                        }
                        fetchPost("/api/filetree/getDoc", getDocParam, getResponse => {
                            onGet({
                                data: getResponse,
                                protyle,
                                action: [Constants.CB_GET_HL],
                                dataDocType: "NodeDocument",
                                afterCB: () => {
                                    target.classList.add("block__icon--active");
                                }
                            });
                        });
                    }
                    break;
                } else if (type === "undo") {
                    protyle.undo.undo(protyle);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "redo") {
                    protyle.undo.redo(protyle);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "outdent") {
                    if (protyle.toolbar.range) {
                        const blockElement = hasClosestBlock(protyle.toolbar.range.startContainer);
                        if (blockElement) {
                            listOutdent(protyle, [blockElement.parentElement], protyle.toolbar.range);
                        }
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "indent") {
                    if (protyle.toolbar.range) {
                        const blockElement = hasClosestBlock(protyle.toolbar.range.startContainer);
                        if (blockElement) {
                            listIndent(protyle, [blockElement.parentElement], protyle.toolbar.range);
                        }
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });
        /// #if !MOBILE
        this.element.addEventListener("contextmenu", (event) => {
            const itemElement = (event.target as HTMLElement).closest(".protyle-breadcrumb__item");
            if (!itemElement || !this.element.contains(itemElement)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.openChildrenMenu(protyle, itemElement.getAttribute("data-node-id"), {
                x: event.clientX,
                y: event.clientY,
                isLeft: false,
            });
        });
        this.element.addEventListener("keydown", (event) => {
            if (event.isComposing || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
                return;
            }
            const itemElement = (event.target as HTMLElement).closest(".protyle-breadcrumb__item") as HTMLElement;
            if (!itemElement || !this.element.contains(itemElement)) {
                return;
            }
            if (!window.siyuan.menus.menu.element.classList.contains("fn__none")) {
                return;
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                const nextItemElement = this.getSiblingItem(itemElement, event.key === "ArrowRight");
                if (nextItemElement) {
                    this.focusItem(nextItemElement);
                }
                event.preventDefault();
                event.stopPropagation();
            } else if (event.key === "ArrowDown" || event.key === "Enter") {
                const itemRect = itemElement.getBoundingClientRect();
                this.openChildrenMenu(protyle, itemElement.getAttribute("data-node-id"), {
                    x: itemRect.left,
                    y: itemRect.bottom,
                    isLeft: false,
                }, true);
                event.preventDefault();
                event.stopPropagation();
            } else if (event.key === "Escape") {
                this.restoreEditorFocus(protyle);
                event.preventDefault();
                event.stopPropagation();
            }
        });
        element.addEventListener("mouseleave", () => {
            protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl").forEach(item => {
                item.classList.remove("protyle-wysiwyg--hl");
            });
        });
        this.element.addEventListener("mousewheel", (event: WheelEvent) => {
            this.element.scrollLeft = this.element.scrollLeft + event.deltaY;
        }, {passive: true});
        /// #endif
    }

    private async openChildrenMenu(protyle: IProtyle, id: string, position: IPosition, keyboard = false) {
        if (!id) {
            return;
        }

        const keyboardItemElement = keyboard ? document.activeElement : undefined;
        const menuName = `${Constants.MENU_BREADCRUMB_CHILDREN}-${id}`;
        const menu = new Menu(menuName);
        if (menu.isOpen) {
            return;
        }

        const currentPathIDs = new Set<string>();
        this.element.querySelectorAll(".protyle-breadcrumb__item").forEach((item) => {
            const itemID = item.getAttribute("data-node-id");
            if (itemID) {
                currentPathIDs.add(itemID);
            }
        });
        let currentBlockElement = this.id ?
            protyle.wysiwyg.element.querySelector(`[data-node-id="${this.id}"]`) as HTMLElement : undefined;
        while (currentBlockElement) {
            const currentBlockID = currentBlockElement.getAttribute("data-node-id");
            if (currentBlockID) {
                currentPathIDs.add(currentBlockID);
            }
            const parentBlockElement = hasClosestBlock(currentBlockElement.parentElement) as HTMLElement;
            if (!parentBlockElement || !protyle.wysiwyg.element.contains(parentBlockElement)) {
                break;
            }
            currentBlockElement = parentBlockElement;
        }
        const excludeTypes: string[] = [];
        if (this.element.parentElement?.parentElement?.classList.contains("card__block")) {
            excludeTypes.push("NodeTextMark-mark");
        }

        let items: IMenu[];
        try {
            items = await this.genChildrenMenuItems(protyle, id, currentPathIDs, excludeTypes);
        } catch (e) {
            console.warn("get breadcrumb children failed", e);
            if (window.siyuan.menus.menu.element.getAttribute("data-name") === menuName) {
                window.siyuan.menus.menu.remove();
            }
            return;
        }
        if (keyboard && document.activeElement !== keyboardItemElement) {
            if (window.siyuan.menus.menu.element.getAttribute("data-name") === menuName) {
                window.siyuan.menus.menu.remove();
            }
            return;
        }
        if (window.siyuan.menus.menu.element.getAttribute("data-name") !== menuName) {
            return;
        }
        if (items.length === 0) {
            window.siyuan.menus.menu.remove();
            return;
        }

        items.forEach((item) => {
            menu.addItem(item);
        });
        menu.open(position);
        if (keyboard) {
            menu.element.querySelector(".b3-menu__item:not([disabled])")?.classList.add("b3-menu__item--current");
        }
    }

    private getSiblingItem(itemElement: HTMLElement, forward: boolean) {
        let siblingElement = forward ? itemElement.nextElementSibling : itemElement.previousElementSibling;
        while (siblingElement && !siblingElement.classList.contains("protyle-breadcrumb__item")) {
            siblingElement = forward ? siblingElement.nextElementSibling : siblingElement.previousElementSibling;
        }
        return siblingElement as HTMLElement;
    }

    private focusItem(itemElement: HTMLElement) {
        this.element.querySelectorAll(".protyle-breadcrumb__item").forEach((item) => {
            item.setAttribute("tabindex", item === itemElement ? "0" : "-1");
        });
        itemElement.focus({preventScroll: true});
        itemElement.scrollIntoView({block: "nearest", inline: "nearest"});
    }

    private restoreEditorFocus(protyle: IProtyle) {
        const focusElement = this.previousFocusElement?.isConnected ? this.previousFocusElement : protyle.wysiwyg.element;
        focusElement.focus({preventScroll: true});
        if (this.previousRange) {
            focusByRange(this.previousRange);
        }
        this.previousFocusElement = undefined;
        this.previousRange = undefined;
    }

    public focus(range?: Range) {
        if (!this.element.isConnected || this.element.getClientRects().length === 0) {
            return false;
        }
        const itemElement = this.element.querySelector(".protyle-breadcrumb__item--active") as HTMLElement ||
            this.element.querySelector(".protyle-breadcrumb__item:last-of-type") as HTMLElement;
        if (!itemElement) {
            return false;
        }
        this.element.classList.remove("protyle-breadcrumb__bar--hide");
        window.siyuan.menus.menu.remove();
        if (!this.element.contains(document.activeElement)) {
            this.previousFocusElement = document.activeElement as HTMLElement;
            this.previousRange = range?.cloneRange();
        }
        this.focusItem(itemElement);
        return true;
    }

    private async genChildrenMenuItems(protyle: IProtyle, id: string, currentPathIDs: Set<string>,
                                       excludeTypes: string[], offset = 0): Promise<IMenu[]> {
        const request: Record<string, any> = {
            id,
            offset,
            limit: 64,
            excludeTypes,
        };
        if (isEncryptedBox(protyle.notebookId)) {
            request.notebook = protyle.notebookId;
        }
        const response = await fetchSyncPost("/api/block/getBlockBreadcrumbChildren", request);
        const data = response.data as {
            items: IBreadcrumb[],
            hasMore: boolean,
        };
        if (!data?.items) {
            return [];
        }

        const items = data.items.map((item) => {
            const menuItem: IMenu = {
                id: item.id,
                icon: getIconByType(item.type, item.subType),
                label: item.name,
                current: currentPathIDs.has(item.id),
                click: () => {
                    zoomOut({protyle, id: item.id});
                },
            };
            if (item.hasChildren) {
                menuItem.loadSubmenu = () => this.genChildrenMenuItems(protyle, item.id, currentPathIDs,
                    excludeTypes);
            }
            return menuItem;
        });

        if (data.hasMore) {
            items.push({
                icon: "iconMore",
                label: window.siyuan.languages.loadMore,
                click: (element) => {
                    element.setAttribute("disabled", "disabled");
                    this.genChildrenMenuItems(protyle, id, currentPathIDs, excludeTypes,
                        offset + data.items.length)
                        .then((nextItems) => {
                            if (!element.isConnected) {
                                return;
                            }
                            let firstNextElement: HTMLElement;
                            nextItems.forEach((item) => {
                                const nextElement = new MenuItem(item).element;
                                if (!firstNextElement) {
                                    firstNextElement = nextElement;
                                }
                                element.before(nextElement);
                            });
                            const moveCurrent = element.classList.contains("b3-menu__item--current");
                            element.remove();
                            if (moveCurrent && firstNextElement) {
                                firstNextElement.classList.add("b3-menu__item--current");
                                firstNextElement.scrollIntoView({block: "nearest"});
                            }
                            window.siyuan.menus.menu.resetPosition();
                        }).catch(() => {
                            element.removeAttribute("disabled");
                        });
                    return true;
                },
            });
        }
        return items;
    }

    private async startRecord(protyle: IProtyle, mediaStream: MediaStream) {
        const recorder = new RecordMedia(mediaStream);
        this.mediaRecorder = recorder;
        try {
            await recorder.startRecording();
        } catch (error) {
            recorder.dispose();
            if (this.mediaRecorder === recorder) {
                this.mediaRecorder = undefined;
            }
            throw error;
        }
        recorder.onerror = (error) => {
            if (this.mediaRecorder !== recorder) {
                return;
            }
            recorder.dispose();
            this.mediaRecorder = undefined;
            hideMessage(this.messageId);
            showMessage(error instanceof RecordMediaInputEndedError ?
                window.siyuan.languages.recordInterrupted : window.siyuan.languages["record-tip"]);
        };
        this.messageId = showMessage(`<div class="fn__flex fn__flex-wrap">
<span class="fn__flex-center">${window.siyuan.languages.recording}</span><span class="fn__space"></span>
<button class="b3-button b3-button--white">${window.siyuan.languages.endRecord}</button></div>`, -1);
        document.querySelector(`#message [data-id="${this.messageId}"] button`).addEventListener("click", () => {
            this.stopRecord(protyle);
        });
    }

    private async stopRecord(protyle: IProtyle) {
        if (this.stoppingRecord || !this.mediaRecorder?.isRecording) {
            return;
        }
        this.stoppingRecord = true;
        const recorder = this.mediaRecorder;
        recorder.onerror = undefined;
        hideMessage(this.messageId);
        try {
            const blob = await recorder.stopRecording();
            const file = new File([blob], `record${Date.now()}.mp3`, {type: "audio/mpeg"});
            this.pendingRecordFiles.add(file);
            this.uploadRecord(protyle, file, protyle.block?.rootID);
        } catch (error) {
            showMessage(error instanceof RecordMediaInputEndedError ?
                window.siyuan.languages.recordInterrupted : window.siyuan.languages["record-tip"]);
        } finally {
            recorder.dispose();
            if (this.mediaRecorder === recorder) {
                this.mediaRecorder = undefined;
            }
            this.stoppingRecord = false;
        }
    }

    private uploadRecord(protyle: IProtyle, file: File, rootID: string) {
        if (!this.pendingRecordFiles.has(file) || this.uploadingRecordFiles.has(file)) {
            return;
        }
        hideMessage(this.recordUploadMessageIds.get(file));
        this.recordUploadMessageIds.delete(file);
        const uploadProtyle = this.findRecordUploadProtyle(protyle, rootID);
        if (!uploadProtyle) {
            this.showRecordUploadRetry(protyle, file, rootID);
            return;
        }

        this.uploadingRecordFiles.add(file);
        try {
            uploadFiles(uploadProtyle, [file], undefined, undefined, (succeeded) => {
                this.uploadingRecordFiles.delete(file);
                if (!this.pendingRecordFiles.has(file)) {
                    return;
                }
                if (succeeded) {
                    this.pendingRecordFiles.delete(file);
                    return;
                }
                this.showRecordUploadRetry(uploadProtyle, file, rootID);
            });
        } catch (error) {
            this.uploadingRecordFiles.delete(file);
            this.showRecordUploadRetry(uploadProtyle, file, rootID);
        }
    }

    private findRecordUploadProtyle(protyle: IProtyle, rootID: string) {
        if (document.body.contains(protyle.element) && (!rootID || protyle.block?.rootID === rootID)) {
            return protyle;
        }
        return getAllEditor().find((editor) => {
            return document.body.contains(editor.protyle.element) &&
                (!rootID || editor.protyle.block?.rootID === rootID);
        })?.protyle;
    }

    private showRecordUploadRetry(protyle: IProtyle, file: File, rootID: string) {
        if (!this.pendingRecordFiles.has(file)) {
            return;
        }
        const messageId = showMessage(`<div class="fn__flex fn__flex-wrap">
<span class="fn__flex-center">${window.siyuan.languages.uploadError}</span><span class="fn__space"></span>
<button class="b3-button b3-button--white">${window.siyuan.languages.retry}</button></div>`, -1);
        this.recordUploadMessageIds.set(file, messageId);
        document.querySelector(`#message [data-id="${messageId}"] button`)?.addEventListener("click", () => {
            this.uploadRecord(protyle, file, rootID);
        });
    }

    private genMobileMenu(protyle: IProtyle) {
        if (protyle.toolbar.isMultiSelectMode()) {
            return;
        }
        const menu = new Menu(Constants.MENU_BREADCRUMB_MOBILE_PATH);
        let blockElement: Element;
        if (getSelection().rangeCount > 0) {
            const range = getSelection().getRangeAt(0);
            if (!protyle.wysiwyg.element.isEqualNode(range.startContainer) && !protyle.wysiwyg.element.contains(range.startContainer)) {
                blockElement = getNoContainerElement(protyle.wysiwyg.element.firstElementChild) || protyle.wysiwyg.element.firstElementChild;
            } else {
                blockElement = hasClosestBlock(range.startContainer) as Element;
            }
        }
        if (!blockElement) {
            blockElement = getNoContainerElement(protyle.wysiwyg.element.firstElementChild) || protyle.wysiwyg.element.firstElementChild;
        }
        if (!blockElement) {
            return;
        }
        const id = blockElement.getAttribute("data-node-id");
        const breadcrumbParam: Record<string, any> = {id, excludeTypes: []};
        if (isEncryptedBox(protyle.notebookId)) {
            breadcrumbParam.notebook = protyle.notebookId;
        }
        fetchPost("/api/block/getBlockBreadcrumb", breadcrumbParam, (response) => {
            response.data.forEach((item: IBreadcrumb) => {
                let isCurrent = false;
                if (!protyle.block.showAll && item.id === protyle.block.parentID) {
                    isCurrent = true;
                } else if (protyle.block.showAll && item.id === protyle.block.id) {
                    isCurrent = true;
                }
                menu.addItem({
                    current: isCurrent,
                    icon: getIconByType(item.type, item.subType),
                    label: item.name,
                    click() {
                        zoomOut({protyle, id: item.id});
                    }
                });
            });
            menu.fullscreen();
        });
    }

    public toggleExit(hide: boolean) {
        const exitFocusElement = this.element.parentElement.querySelector('[data-type="exit-focus"]');
        if (hide) {
            exitFocusElement.classList.add("fn__none");
        } else {
            exitFocusElement.classList.remove("fn__none");
        }
    }

    public showMenu(protyle: IProtyle, position: IPosition) {
        if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
            window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_BREADCRUMB_MORE) {
            window.siyuan.menus.menu.remove();
            return;
        }
        let id;
        const cursorNodeElement = hasClosestBlock(getEditorRange(protyle.element).startContainer);
        if (cursorNodeElement) {
            id = cursorNodeElement.getAttribute("data-node-id");
        }
        fetchPost("/api/block/getTreeStat", {id: id || (protyle.block.showAll ? protyle.block.id : protyle.block.rootID)}, (response) => {
            window.siyuan.menus.menu.remove();
            window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_BREADCRUMB_MORE);
            if (!protyle.contentElement.classList.contains("fn__none") && !protyle.disabled) {
                let uploadHTML = "";
                uploadHTML = '<input class="b3-form__upload" type="file" multiple="multiple"';
                if (protyle.options.upload.accept) {
                    uploadHTML += ` accept="${protyle.options.upload.accept}">`;
                } else {
                    uploadHTML += ">";
                }
                if (isInAndroid()) {
                    const imageUploadMenu = new MenuItem({
                        id: "insertImage",
                        icon: "iconImage",
                        label: `${window.siyuan.languages.insertImage}<input class="b3-form__upload" type="file" multiple="multiple" accept="image/*,application/x-siyuan-image-picker">`,
                    }).element;
                    imageUploadMenu.querySelector("input").addEventListener("change", (event: InputEvent & {
                        target: HTMLInputElement
                    }) => {
                        if (event.target.files.length === 0) {
                            return;
                        }
                        uploadFiles(protyle, event.target.files, event.target);
                        window.siyuan.menus.menu.remove();
                    });
                    window.siyuan.menus.menu.append(imageUploadMenu);
                }
                const uploadMenu = new MenuItem({
                    id: "insertAsset",
                    icon: "iconDownload",
                    label: `${window.siyuan.languages.insertAsset}${uploadHTML}`,
                }).element;
                uploadMenu.querySelector("input").addEventListener("change", (event: InputEvent & {
                    target: HTMLInputElement
                }) => {
                    if (event.target.files.length === 0) {
                        return;
                    }
                    uploadFiles(protyle, event.target.files, event.target);
                    window.siyuan.menus.menu.remove();
                });
                window.siyuan.menus.menu.append(uploadMenu);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: this.mediaRecorder?.isRecording ? "endRecord" : "startRecord",
                    current: this.mediaRecorder && this.mediaRecorder.isRecording,
                    icon: "iconRecord",
                    label: this.mediaRecorder?.isRecording ? window.siyuan.languages.endRecord : window.siyuan.languages.startRecord,
                    click: async () => {
                        if (this.startingRecord || this.stoppingRecord) {
                            return;
                        }
                        if (this.mediaRecorder?.isRecording) {
                            this.stopRecord(protyle);
                            return;
                        }

                        this.startingRecord = true;
                        let mediaStream: MediaStream;
                        try {
                            /// #if !BROWSER
                            if (window.siyuan.config.system.os === "darwin") {
                                const status = await ipcRenderer.invoke(Constants.SIYUAN_GET, {cmd: "getMicrophone"});
                                if (["denied", "restricted", "unknown"].includes(status)) {
                                    showMessage(window.siyuan.languages.microphoneDenied);
                                    return;
                                } else if (status === "not-determined") {
                                    const isAccess = await ipcRenderer.invoke(Constants.SIYUAN_GET, {cmd: "askMicrophone"});
                                    if (!isAccess) {
                                        showMessage(window.siyuan.languages.microphoneNotAccess);
                                        return;
                                    }
                                }
                            }
                            /// #endif

                            mediaStream = await navigator.mediaDevices.getUserMedia({
                                audio: isInAndroid() || isInHarmony() ? {
                                    autoGainControl: false,
                                    echoCancellation: false,
                                    noiseSuppression: false,
                                } : true,
                            });
                            await this.startRecord(protyle, mediaStream);
                        } catch (error) {
                            mediaStream?.getTracks().forEach((track) => track.stop());
                            if (error instanceof RecordMediaInputEndedError) {
                                showMessage(window.siyuan.languages.recordInterrupted);
                            } else if ((!isInAndroid() && !isInHarmony()) ||
                                !(error instanceof DOMException && error.name === "NotAllowedError")) {
                                showMessage(window.siyuan.languages["record-tip"]);
                            }
                        } finally {
                            this.startingRecord = false;
                        }
                    }
                }).element);
            }
            if (!protyle.disabled) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "netImg2LocalAsset",
                    label: window.siyuan.languages.netImg2LocalAsset,
                    icon: "iconImgDown",
                    accelerator: window.siyuan.config.keymap.editor.general.netImg2LocalAsset.custom,
                    click() {
                        net2LocalAssets(protyle, "Img");
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "netAssets2LocalAssets",
                    label: window.siyuan.languages.netAssets2LocalAssets,
                    icon: "iconDownloadAssets",
                    accelerator: window.siyuan.config.keymap.editor.general.netAssets2LocalAssets.custom,
                    click() {
                        net2LocalAssets(protyle, "Assets");
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "uploadAssets2CDN",
                    label: window.siyuan.languages.uploadAssets2CDN,
                    icon: "iconUploadAssets",
                    click() {
                        if (!needSubscribe()) {
                            confirmDialog("📦 " + window.siyuan.languages.uploadAssets2CDN, window.siyuan.languages.uploadAssets2CDNConfirmTip, () => {
                                fetchPost("/api/asset/uploadCloud", {id: protyle.block.id});
                            });
                        }
                    }
                }).element);
                if (window.siyuan.user) { // 登录链滴账号后即可使用 `分享到链滴` https://github.com/siyuan-note/siyuan/issues/7392
                    window.siyuan.menus.menu.append(new MenuItem({
                        id: "share2Liandi",
                        label: window.siyuan.languages.share2Liandi,
                        icon: "iconLiandi",
                        click() {
                            confirmDialog("🤩 " + window.siyuan.languages.share2Liandi,
                                window.siyuan.languages.share2LiandiConfirmTip.replace("${accountServer}", getCloudURL("")), () => {
                                    fetchPost("/api/export/export2Liandi", {id: protyle.block.parentID});
                                });
                        }
                    }).element);
                }
            }
            if (!protyle.scroll?.element.classList.contains("fn__none")) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "keepLazyLoad",
                    icon: "iconKeepContent",
                    current: protyle.scroll.keepLazyLoad,
                    label: window.siyuan.languages.keepLazyLoad,
                    click: () => {
                        protyle.scroll.keepLazyLoad = !protyle.scroll.keepLazyLoad;
                    }
                }).element);
            }
            if (window.siyuan.menus.menu.element.lastElementChild.childElementCount > 0) {
                window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({
                id: "refresh",
                icon: "iconRefresh",
                accelerator: window.siyuan.config.keymap.editor.general.refresh.custom,
                label: window.siyuan.languages.refresh,
                click: () => {
                    reloadProtyle(protyle, !isMobile());
                }
            }).element);
            if (!protyle.disabled) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "optimizeTypography",
                    label: window.siyuan.languages.optimizeTypography,
                    accelerator: window.siyuan.config.keymap.editor.general.optimizeTypography.custom,
                    icon: "iconFormat",
                    click: () => {
                        hideElements(["toolbar"], protyle);
                        fetchPost("/api/format/autoSpace", {
                            id: protyle.block.rootID
                        });
                    }
                }).element);
            }
            /// #if !MOBILE
            window.siyuan.menus.menu.append(new MenuItem({
                id: "fullscreen",
                icon: protyle.element.className.includes("fullscreen") ? "iconFullscreenExit" : "iconFullscreen",
                accelerator: window.siyuan.config.keymap.editor.general.fullscreen.custom,
                label: window.siyuan.languages.fullscreen,
                click: () => {
                    fullscreen(protyle.element);
                    resize(protyle);
                }
            }).element);
            /// #endif
            window.siyuan.menus.menu.append(new MenuItem({
                id: "editMode",
                icon: "iconEdit",
                label: window.siyuan.languages["edit-mode"],
                type: "submenu",
                submenu: [{
                    id: "wysiwyg",
                    current: !protyle.contentElement.classList.contains("fn__none"),
                    label: window.siyuan.languages.wysiwyg,
                    accelerator: window.siyuan.config.keymap.editor.general.wysiwyg.custom,
                    click: () => {
                        setEditMode(protyle, "wysiwyg");
                        reloadProtyle(protyle, true);
                        /// #if !MOBILE
                        saveLayout();
                        /// #endif
                    }
                }, {
                    id: "preview",
                    current: !protyle.preview.element.classList.contains("fn__none"),
                    icon: "iconPreview",
                    label: window.siyuan.languages.preview,
                    accelerator: window.siyuan.config.keymap.editor.general.preview.custom,
                    click: () => {
                        setEditMode(protyle, "preview");
                        window.siyuan.menus.menu.remove();
                        /// #if !MOBILE
                        saveLayout();
                        /// #endif
                    }
                }]
            }).element);
            if (!window.siyuan.config.editor.readOnly && !window.siyuan.config.readonly) {
                const isCustomReadonly = protyle.wysiwyg.element.getAttribute(Constants.CUSTOM_SY_READONLY);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "editReadonly",
                    label: window.siyuan.languages.editReadonly,
                    icon: "iconLock",
                    type: "submenu",
                    submenu: [{
                        id: "enable",
                        iconHTML: "",
                        current: isCustomReadonly === "true",
                        label: window.siyuan.languages.enable,
                        click() {
                            fetchPost("/api/attr/setBlockAttrs", {
                                id: protyle.block.rootID,
                                attrs: {[Constants.CUSTOM_SY_READONLY]: "true"}
                            });
                        }
                    }, {
                        id: "disable",
                        iconHTML: "",
                        current: !isCustomReadonly || isCustomReadonly === "false",
                        label: window.siyuan.languages.disable,
                        click() {
                            fetchPost("/api/attr/setBlockAttrs", {
                                id: protyle.block.rootID,
                                attrs: {[Constants.CUSTOM_SY_READONLY]: "false"}
                            });
                        }
                    }]
                }).element);
            }
            /// #if !MOBILE
            if (!protyle.disabled) {
                const isCustomFullWidth = protyle.wysiwyg.element.getAttribute(Constants.CUSTOM_SY_FULLWIDTH);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "fullWidth",
                    label: window.siyuan.languages.fullWidth,
                    icon: "iconFullWidth",
                    type: "submenu",
                    submenu: [{
                        id: "enable",
                        iconHTML: "",
                        current: isCustomFullWidth === "true",
                        label: window.siyuan.languages.enable,
                        click() {
                            fetchPost("/api/attr/setBlockAttrs", {
                                id: protyle.block.rootID,
                                attrs: {[Constants.CUSTOM_SY_FULLWIDTH]: "true"}
                            });
                        }
                    }, {
                        id: "disable",
                        iconHTML: "",
                        current: isCustomFullWidth === "false",
                        label: window.siyuan.languages.disable,
                        click() {
                            fetchPost("/api/attr/setBlockAttrs", {
                                id: protyle.block.rootID,
                                attrs: {[Constants.CUSTOM_SY_FULLWIDTH]: "false"}
                            });
                        }
                    }, {
                        id: "default",
                        iconHTML: "",
                        current: !isCustomFullWidth,
                        label: window.siyuan.languages.default,
                        click() {
                            fetchPost("/api/attr/setBlockAttrs", {
                                id: protyle.block.rootID,
                                attrs: {[Constants.CUSTOM_SY_FULLWIDTH]: ""}
                            });
                        }
                    }]
                }).element);
                const isCustomHeadingNumber = protyle.wysiwyg.element.getAttribute(
                    Constants.CUSTOM_SY_HEADING_NUMBER
                );
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "headingNumber",
                    label: window.siyuan.languages.headingNumber,
                    icon: "iconHeadings",
                    type: "submenu",
                    submenu: [{
                        id: "enable",
                        iconHTML: "",
                        current: isCustomHeadingNumber === "true",
                        label: window.siyuan.languages.enable,
                        click() {
                            fetchPost("/api/attr/setBlockAttrs", {
                                id: protyle.block.rootID,
                                attrs: {[Constants.CUSTOM_SY_HEADING_NUMBER]: "true"}
                            });
                        }
                    }, {
                        id: "disable",
                        iconHTML: "",
                        current: isCustomHeadingNumber === "false",
                        label: window.siyuan.languages.disable,
                        click() {
                            fetchPost("/api/attr/setBlockAttrs", {
                                id: protyle.block.rootID,
                                attrs: {[Constants.CUSTOM_SY_HEADING_NUMBER]: "false"}
                            });
                        }
                    }, {
                        id: "default",
                        iconHTML: "",
                        current: !isCustomHeadingNumber,
                        label: window.siyuan.languages.default,
                        click() {
                            fetchPost("/api/attr/setBlockAttrs", {
                                id: protyle.block.rootID,
                                attrs: {[Constants.CUSTOM_SY_HEADING_NUMBER]: ""}
                            });
                        }
                    }]
                }).element);
            }
            /// #endif
            if (protyle?.app?.plugins) {
                emitOpenMenu({
                    plugins: protyle.app.plugins,
                    type: "open-menu-breadcrumbmore",
                    detail: {
                        protyle,
                        data: response.data.stat,
                    },
                    separatorPosition: "top",
                });
            }
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "docInfo",
                iconHTML: "",
                type: "readonly",
                // 不能换行，否则移动端间距过大
                label: `<div class="fn__flex">${window.siyuan.languages.runeCount}<span class="fn__space fn__flex-1"></span>${response.data.stat.runeCount}</div><div class="fn__flex">${window.siyuan.languages.wordCount}<span class="fn__space fn__flex-1"></span>${response.data.stat.wordCount}</div><div class="fn__flex">${window.siyuan.languages.linkCount}<span class="fn__space fn__flex-1"></span>${response.data.stat.linkCount}</div><div class="fn__flex">${window.siyuan.languages.imgCount}<span class="fn__space fn__flex-1"></span>${response.data.stat.imageCount}</div><div class="fn__flex">${window.siyuan.languages.refCount}<span class="fn__space fn__flex-1"></span>${response.data.stat.refCount}</div><div class="fn__flex">${window.siyuan.languages.blockCount}<span class="fn__space fn__flex-1"></span>${response.data.stat.blockCount}</div>`,
            }).element);
            /// #if MOBILE
            window.siyuan.menus.menu.fullscreen();
            /// #else
            window.siyuan.menus.menu.popup(position);
            /// #endif
            const popoverElement = hasTopClosestByClassName(protyle.element, "block__popover", true);
            window.siyuan.menus.menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover" : "app");
        });
    }

    public render(protyle: IProtyle, update = false, nodeElement?: Element | false) {
        if (protyle.element.getAttribute("disabled-forever") === "true") {
            return;
        }
        refreshUndoButtons(protyle);
        /// #if !MOBILE
        let range: Range;
        let blockElement: Element;
        if (nodeElement &&
            !nodeElement.classList.contains("list")   // 列表 id 不会返回数据，因此不进行处理 https://github.com/siyuan-note/siyuan/issues/11685
        ) {
            blockElement = nodeElement;
        } else if (getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
            if (!protyle.wysiwyg.element.isEqualNode(range.startContainer) && !protyle.wysiwyg.element.contains(range.startContainer)) {
                if (protyle.element.id === "searchPreview") {
                    // https://github.com/siyuan-note/siyuan/issues/8807
                    blockElement = hasClosestBlock(protyle.wysiwyg.element.querySelector('[data-type="search-mark"]')) as Element;
                } else {
                    blockElement = getNoContainerElement(protyle.wysiwyg.element.firstElementChild) || protyle.wysiwyg.element.firstElementChild;
                }
            } else {
                blockElement = hasClosestBlock(range.startContainer) as Element;
            }
        }
        if (!blockElement) {
            blockElement = getNoContainerElement(protyle.wysiwyg.element.firstElementChild) || protyle.wysiwyg.element.firstElementChild;
        }
        if (!blockElement) {
            // 浮窗删除单个块后，面包屑无法获取到 blockElement，直接返回即可
            return;
        }
        const id = blockElement.getAttribute("data-node-id");
        if (id === this.id && !update) {
            protyle.breadcrumb.element.querySelectorAll(".protyle-breadcrumb__item--active").forEach(item => {
                item.classList.remove("protyle-breadcrumb__item--active");
            });
            const currentElement = protyle.breadcrumb.element.querySelector(`[data-node-id="${protyle.block.showAll ? protyle.block.id : protyle.block.parentID}"]`);
            if (currentElement) {
                currentElement.classList.add("protyle-breadcrumb__item--active");
            }
            return;
        }
        this.id = id;
        const excludeTypes: string[] = [];
        if (this.element.parentElement?.parentElement && this.element.parentElement.parentElement.classList.contains("card__block")) {
            // 闪卡面包屑不能显示答案
            excludeTypes.push("NodeTextMark-mark");
        }
        const breadcrumbParam: Record<string, any> = {id, excludeTypes};
        if (isEncryptedBox(protyle.notebookId)) {
            breadcrumbParam.notebook = protyle.notebookId;
        }
        fetchPost("/api/block/getBlockBreadcrumb", breadcrumbParam, (response) => {
            let html = "";
            response.data.forEach((item: IBreadcrumb, index: number) => {
                let isCurrent = false;
                if (!protyle.block.showAll && item.id === protyle.block.parentID) {
                    isCurrent = true;
                } else if (protyle.block.showAll && item.id === protyle.block.id) {
                    isCurrent = true;
                }
                if (index === 0 && !protyle.options.render.breadcrumbDocName) {
                    html += `<span class="protyle-breadcrumb__item${isCurrent ? " protyle-breadcrumb__item--active" : ""}" data-node-id="${item.id}" role="button" tabindex="-1" aria-label="${escapeAriaLabel(item.name || window.siyuan.languages.untitled)}"${response.data.length === 1 ? ' style="max-width:none"' : ""}>
    <svg class="popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.type, item.subType)}"></use></svg>
</span>`;
                } else {
                    html += `<span class="protyle-breadcrumb__item${isCurrent ? " protyle-breadcrumb__item--active" : ""}" data-node-id="${item.id}" role="button" tabindex="-1" aria-label="${escapeAriaLabel(item.name || window.siyuan.languages.untitled)}"${(response.data.length === 1 || index === 0) ? ' style="max-width:none"' : ""}>
    <svg class="popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.type, item.subType)}"></use></svg>
    ${item.name ? `<span class="protyle-breadcrumb__text" title="${item.name}">${item.name}</span>` : ""}
</span>`;
                }
                if (index !== response.data.length - 1) {
                    html += `<button class="protyle-breadcrumb__arrow protyle-breadcrumb__arrow--interactive ariaLabel" aria-label="${window.siyuan.languages.expand}" type="button" tabindex="-1"><svg><use xlink:href="#iconRight"></use></svg></button>`;
                }
            });
            this.element.innerHTML = html;
            improveBreadcrumbAppearance(this.element.parentElement);
        });
        /// #endif
    }

    public hide() {
        if (isMobile()) {
            return;
        }
        this.element.classList.add("protyle-breadcrumb__bar--hide");
        window.siyuan.hideBreadcrumb = true;
    }
}
