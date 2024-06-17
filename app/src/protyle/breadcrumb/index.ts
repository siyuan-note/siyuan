import {getIconByType} from "../../editor/getIcon";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {MenuItem} from "../../menus/Menu";
import {fullscreen, net2LocalAssets, updateReadonly} from "./action";
import {openFileAttr} from "../../menus/commonMenuItem";
import {setEditMode} from "../util/setEditMode";
import {RecordMedia} from "../util/RecordMedia";
import {hideMessage, showMessage} from "../../dialog/message";
import {uploadFiles} from "../upload";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {needSubscribe} from "../../util/needSubscribe";
import {isMobile} from "../../util/functions";
import {zoomOut} from "../../menus/protyle";
import {getEditorRange} from "../util/selection";
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
import {isInAndroid, isIPad, isMac, updateHotkeyTip} from "../util/compatibility";
import {resize} from "../util/resize";
import {listIndent, listOutdent} from "../wysiwyg/list";

export class Breadcrumb {
    public element: HTMLElement;
    private mediaRecorder: RecordMedia;
    private id: string;
    private messageId: string;

    constructor(protyle: IProtyle) {
        const element = document.createElement("div");
        element.className = "protyle-breadcrumb";
        let padHTML = "";
        /// #if BROWSER && !MOBILE
        if (isIPad() || isInAndroid()) {
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
<button class="block__icon fn__flex-center ariaLabel${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.lockEdit}" data-type="readonly"><svg><use xlink:href="#iconUnlock"></use></svg></button>
<button class="block__icon fn__flex-center ariaLabel" data-type="doc" aria-label="${isMac() ? window.siyuan.languages.gutterTip2 : window.siyuan.languages.gutterTip2.replace("⇧", "Shift+")}"><svg><use xlink:href="#iconFile"></use></svg></button>
<button class="block__icon fn__flex-center ariaLabel" data-type="more" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></button>
<button class="block__icon fn__flex-center fn__none ariaLabel" data-type="context" aria-label="${window.siyuan.languages.context}"><svg><use xlink:href="#iconAlignCenter"></use></svg></button>`;
        this.element = element.firstElementChild as HTMLElement;
        element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
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
                    if (window.siyuan.shiftIsPressed) {
                        fetchPost("/api/block/getDocInfo", {
                            id: protyle.block.rootID
                        }, (response) => {
                            openFileAttr(response.data.ial, "bookmark", protyle);
                        });
                    } else {
                        const targetRect = target.getBoundingClientRect();
                        openTitleMenu(protyle, {x: targetRect.right, y: targetRect.bottom, isLeft: true});
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
                    zoomOut({protyle, id: protyle.block.rootID, focusId: protyle.block.id});
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "context") {
                    event.stopPropagation();
                    event.preventDefault();
                    if (target.classList.contains("block__icon--active")) {
                        zoomOut({protyle, id: protyle.options.blockId});
                        target.classList.remove("block__icon--active");
                    } else {
                        fetchPost("/api/filetree/getDoc", {
                            id: protyle.options.blockId,
                            mode: 3,
                            size: window.siyuan.config.editor.dynamicLoadBlocks,
                        }, getResponse => {
                            onGet({data: getResponse, protyle, action: [Constants.CB_GET_HL]});
                        });
                        target.classList.add("block__icon--active");
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
        /// if !MOBILE
        element.addEventListener("mouseleave", () => {
            protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl").forEach(item => {
                item.classList.remove("protyle-wysiwyg--hl");
            });
        });
        this.element.addEventListener("mouseover", (event) => {
            if (!protyle.selectElement.classList.contains("fn__none")) {
                return;
            }
            const target = event.target as HTMLElement;
            const svgElement = hasClosestByAttribute(target, "data-node-id", null);
            if (svgElement) {
                protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl").forEach(item => {
                    item.classList.remove("protyle-wysiwyg--hl");
                });
                const nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${svgElement.getAttribute("data-node-id")}"]`);
                if (nodeElement) {
                    nodeElement.classList.add("protyle-wysiwyg--hl");
                }
            }
        });
        this.element.addEventListener("mousewheel", (event: WheelEvent) => {
            this.element.scrollLeft = this.element.scrollLeft + event.deltaY;
        }, {passive: true});
        /// #endif
    }

    private startRecord(protyle: IProtyle) {
        this.messageId = showMessage(`<div class="fn__flex fn__flex-wrap">
<span class="fn__flex-center">${window.siyuan.languages.recording}</span><span class="fn__space"></span>
<button class="b3-button b3-button--white">${window.siyuan.languages.endRecord}</button></div>`, -1);
        document.querySelector(`#message [data-id="${this.messageId}"] button`).addEventListener("click", () => {
            this.mediaRecorder.stopRecording();
            hideMessage(this.messageId);
            const file: File = new File([this.mediaRecorder.buildWavFileBlob()],
                `record${(new Date()).getTime()}.wav`, {type: "video/webm"});
            uploadFiles(protyle, [file]);
        });
        this.mediaRecorder.startRecordingNewWavFile();
    }

    private genMobileMenu(protyle: IProtyle) {
        const menu = new Menu("breadcrumb-mobile-path");
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
        const id = blockElement.getAttribute("data-node-id");
        fetchPost("/api/block/getBlockBreadcrumb", {id, excludeTypes: []}, (response) => {
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
                        zoomOut({protyle, id: item.id, focusId: id});
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
            window.siyuan.menus.menu.element.getAttribute("data-name") === "breadcrumbMore") {
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
            window.siyuan.menus.menu.element.setAttribute("data-name", "breadcrumbMore");
            if (!protyle.contentElement.classList.contains("fn__none") && !protyle.disabled) {
                let uploadHTML = "";
                uploadHTML = '<input class="b3-form__upload" type="file" multiple="multiple"';
                if (protyle.options.upload.accept) {
                    uploadHTML += ` accept="${protyle.options.upload.accept}">`;
                } else {
                    uploadHTML += ">";
                }
                const uploadMenu = new MenuItem({
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
                if (!isInAndroid()) {
                    window.siyuan.menus.menu.append(new MenuItem({
                        current: this.mediaRecorder && this.mediaRecorder.isRecording,
                        icon: "iconRecord",
                        label: this.mediaRecorder?.isRecording ? window.siyuan.languages.endRecord : window.siyuan.languages.startRecord,
                        click: async () => {
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

                            if (!this.mediaRecorder) {
                                navigator.mediaDevices.getUserMedia({audio: true}).then((mediaStream: MediaStream) => {
                                    this.mediaRecorder = new RecordMedia(mediaStream);
                                    this.mediaRecorder.recorder.onaudioprocess = (e: AudioProcessingEvent) => {
                                        // Do nothing if not recording:
                                        if (!this.mediaRecorder.isRecording) {
                                            return;
                                        }
                                        // Copy the data from the input buffers;
                                        const left = e.inputBuffer.getChannelData(0);
                                        const right = e.inputBuffer.getChannelData(1);
                                        this.mediaRecorder.cloneChannelData(left, right);
                                    };
                                    this.startRecord(protyle);
                                }).catch(() => {
                                    showMessage(window.siyuan.languages["record-tip"]);
                                });
                                return;
                            }

                            if (this.mediaRecorder.isRecording) {
                                this.mediaRecorder.stopRecording();
                                hideMessage(this.messageId);
                                const file: File = new File([this.mediaRecorder.buildWavFileBlob()],
                                    `record${(new Date()).getTime()}.wav`, {type: "video/webm"});
                                uploadFiles(protyle, [file]);
                            } else {
                                hideMessage(this.messageId);
                                this.startRecord(protyle);
                            }
                        }
                    }).element);
                }
            }
            if (!protyle.disabled) {
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.netImg2LocalAsset,
                    icon: "iconImgDown",
                    accelerator: window.siyuan.config.keymap.editor.general.netImg2LocalAsset.custom,
                    click() {
                        net2LocalAssets(protyle, "Img");
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.netAssets2LocalAssets,
                    icon: "iconTransform",
                    accelerator: window.siyuan.config.keymap.editor.general.netAssets2LocalAssets.custom,
                    click() {
                        net2LocalAssets(protyle, "Assets");
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.uploadAssets2CDN,
                    icon: "iconCloudSucc",
                    click() {
                        if (!needSubscribe()) {
                            confirmDialog("📦 " + window.siyuan.languages.uploadAssets2CDN, window.siyuan.languages.uploadAssets2CDNConfirmTip, () => {
                                fetchPost("/api/asset/uploadCloud", {id: protyle.block.parentID});
                            });
                        }
                    }
                }).element);
                if (window.siyuan.user) { // 登录链滴账号后即可使用 `分享到链滴` https://github.com/siyuan-note/siyuan/issues/7392
                    window.siyuan.menus.menu.append(new MenuItem({
                        label: window.siyuan.languages.share2Liandi,
                        icon: "iconLiandi",
                        click() {
                            confirmDialog("🚀 " + window.siyuan.languages.share2Liandi, window.siyuan.languages.share2LiandiConfirmTip, () => {
                                fetchPost("/api/export/export2Liandi", {id: protyle.block.parentID});
                            });
                        }
                    }).element);
                }
            }
            if (!protyle.scroll?.element.classList.contains("fn__none")) {
                window.siyuan.menus.menu.append(new MenuItem({
                    current: protyle.scroll.keepLazyLoad,
                    label: window.siyuan.languages.keepLazyLoad,
                    click: () => {
                        protyle.scroll.keepLazyLoad = !protyle.scroll.keepLazyLoad;
                    }
                }).element);
            }
            if (window.siyuan.menus.menu.element.lastElementChild.childElementCount > 0) {
                window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconRefresh",
                accelerator: window.siyuan.config.keymap.editor.general.refresh.custom,
                label: window.siyuan.languages.refresh,
                click: () => {
                    reloadProtyle(protyle, !isMobile());
                }
            }).element);
            if (!protyle.disabled) {
                window.siyuan.menus.menu.append(new MenuItem({
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
                icon: "iconEdit",
                label: window.siyuan.languages["edit-mode"],
                type: "submenu",
                submenu: [{
                    current: !protyle.contentElement.classList.contains("fn__none"),
                    label: window.siyuan.languages.wysiwyg,
                    accelerator: window.siyuan.config.keymap.editor.general.wysiwyg.custom,
                    click: () => {
                        setEditMode(protyle, "wysiwyg");
                        protyle.scroll.lastScrollTop = 0;
                        fetchPost("/api/filetree/getDoc", {
                            id: protyle.block.parentID,
                            size: window.siyuan.config.editor.dynamicLoadBlocks,
                        }, getResponse => {
                            onGet({data: getResponse, protyle});
                        });
                        /// #if !MOBILE
                        saveLayout();
                        /// #endif
                    }
                }, {
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
                    label: window.siyuan.languages.editReadonly,
                    icon: "iconLock",
                    type: "submenu",
                    submenu: [{
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
                    label: window.siyuan.languages.fullWidth,
                    icon: "iconDock",
                    type: "submenu",
                    submenu: [{
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
            }
            /// #endif
            if (protyle?.app?.plugins) {
                emitOpenMenu({
                    plugins: protyle.app.plugins,
                    type: "open-menu-breadcrumbmore",
                    detail: {
                        protyle,
                        data: response.data,
                    },
                    separatorPosition: "top",
                });
            }
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                iconHTML: "",
                type: "readonly",
                // 不能换行，否则移动端间距过大
                label: `<div class="fn__flex">${window.siyuan.languages.runeCount}<span class="fn__space fn__flex-1"></span>${response.data.runeCount}</div><div class="fn__flex">${window.siyuan.languages.wordCount}<span class="fn__space fn__flex-1"></span>${response.data.wordCount}</div><div class="fn__flex">${window.siyuan.languages.linkCount}<span class="fn__space fn__flex-1"></span>${response.data.linkCount}</div><div class="fn__flex">${window.siyuan.languages.imgCount}<span class="fn__space fn__flex-1"></span>${response.data.imageCount}</div><div class="fn__flex">${window.siyuan.languages.refCount}<span class="fn__space fn__flex-1"></span>${response.data.refCount}</div>`,
            }).element);
            /// #if MOBILE
            window.siyuan.menus.menu.fullscreen();
            /// #else
            window.siyuan.menus.menu.popup(position);
            /// #endif
        });
    }

    public render(protyle: IProtyle, update = false, nodeElement?: Element | false) {
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
        fetchPost("/api/block/getBlockBreadcrumb", {id, excludeTypes}, (response) => {
            let html = "";
            response.data.forEach((item: IBreadcrumb, index: number) => {
                let isCurrent = false;
                if (!protyle.block.showAll && item.id === protyle.block.parentID) {
                    isCurrent = true;
                } else if (protyle.block.showAll && item.id === protyle.block.id) {
                    isCurrent = true;
                }
                if (index === 0 && !protyle.options.render.breadcrumbDocName) {
                    html += `<span class="protyle-breadcrumb__item${isCurrent ? " protyle-breadcrumb__item--active" : ""}" data-node-id="${item.id}"${response.data.length === 1 ? ' style="max-width:none"' : ""}>
    <svg class="popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.type, item.subType)}"></use></svg>
</span>`;
                } else {
                    html += `<span class="protyle-breadcrumb__item${isCurrent ? " protyle-breadcrumb__item--active" : ""}" data-node-id="${item.id}"${(response.data.length === 1 || index === 0) ? ' style="max-width:none"' : ""}>
    <svg class="popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.type, item.subType)}"></use></svg>
    <span class="protyle-breadcrumb__text" title="${item.name}">${item.name}</span>
</span>`;
                }
                if (index !== response.data.length - 1) {
                    html += '<svg class="protyle-breadcrumb__arrow"><use xlink:href="#iconRight"></use></svg>';
                }
            });
            this.element.classList.remove("protyle-breadcrumb__bar--nowrap");
            this.element.innerHTML = html;
            const itemElements = Array.from(this.element.querySelectorAll(".protyle-breadcrumb__text"));
            if (itemElements.length === 0) {
                return;
            }
            let jump = false;
            while (this.element.scrollHeight > 30 && !jump && itemElements.length > 1) {
                itemElements.find((item, index) => {
                    if (index > 0) {
                        if (!item.classList.contains("protyle-breadcrumb__text--ellipsis")) {
                            item.classList.add("protyle-breadcrumb__text--ellipsis");
                            return true;
                        }
                        if (index === itemElements.length - 1 && item.classList.contains("protyle-breadcrumb__text--ellipsis")) {
                            jump = true;
                        }
                    }
                });
            }
            this.element.classList.add("protyle-breadcrumb__bar--nowrap");
            if (this.element.lastElementChild) {
                this.element.scrollLeft = (this.element.lastElementChild as HTMLElement).offsetLeft - this.element.clientWidth + 14;
            }
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
