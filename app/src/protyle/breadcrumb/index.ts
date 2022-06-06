import {getIconByType} from "../../editor/getIcon";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {MenuItem} from "../../menus/Menu";
import {fullscreen} from "./action";
import {exportMd} from "../../menus/commonMenuItem";
import {setEditMode} from "../util/setEditMode";
import {RecordMedia} from "../util/RecordMedia";
import {hideMessage, showMessage} from "../../dialog/message";
import {uploadFiles} from "../upload";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../util/hasClosest";
import {needSubscribe} from "../../util/needSubscribe";
import {isMobile} from "../../util/functions";
import {zoomOut} from "../../menus/protyle";
import {getEditorRange} from "../util/selection";
import {setPadding} from "../ui/initUI";
import {onGet} from "../util/onGet";
/// #if !BROWSER
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {openFileById} from "../../editor/util";
import {getAllModels} from "../../layout/getAll";

export class Breadcrumb {
    public element: HTMLElement;
    private mediaRecorder: RecordMedia;
    private id: string;

    constructor(protyle: IProtyle) {
        const element = document.createElement("div");
        element.className = "protyle-breadcrumb";
        let html = `<div class="protyle-breadcrumb__bar"></div>
<span class="fn__space fn__flex-shrink"></span>
<button class="b3-tooltips b3-tooltips__w block__icon fn__flex-center" style="opacity: 1;" data-menu="true" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></button>`;
        if (protyle.options.render.breadcrumbContext) {
            html += `<span class="fn__space"></span>
<div class="b3-tooltips b3-tooltips__w block__icon fn__flex-center" style="opacity: 1;" data-type="context" aria-label="${window.siyuan.languages.context}"><svg><use xlink:href="#iconAlignCenter"></use></svg></div>`;
        }
        element.innerHTML = html;
        this.element = element.firstElementChild as HTMLElement;
        element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(element)) {
                const id = target.getAttribute("data-node-id");
                if (id) {
                    if (protyle.options.render.breadcrumbDocName && window.siyuan.ctrlIsPressed) {
                        if (!isMobile()) {
                            openFileById({id, action: [Constants.CB_GET_FOCUS]});
                        }
                    } else {
                        zoomOut(protyle, id);
                    }
                    event.preventDefault();
                    break;
                } else if (target.getAttribute("data-menu") === "true") {
                    this.showMenu(protyle, {
                        x: event.clientX,
                        y: event.clientY
                    });
                    event.preventDefault();
                    break;
                } else if (target.getAttribute("data-type") === "context") {
                    if (target.classList.contains("block__icon--active")) {
                        fetchPost("/api/filetree/getDoc", {
                            id: protyle.options.blockId,
                            mode: 0,
                            size: Constants.SIZE_GET,
                        }, getResponse => {
                            onGet(getResponse, protyle);
                        });
                        target.classList.remove("block__icon--active");
                    } else {
                        fetchPost("/api/filetree/getDoc", {
                            id: protyle.options.blockId,
                            mode: 3,
                            size: Constants.SIZE_GET,
                        }, getResponse => {
                            onGet(getResponse, protyle, [Constants.CB_GET_HL]);
                        });
                        target.classList.add("block__icon--active");
                    }
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
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
        /// #if !BROWSER
        if ("windows" !== window.siyuan.config.system.os && "linux" !== window.siyuan.config.system.os) {
            const currentWindow = getCurrentWindow();
            element.querySelector(".fn__flex-shrink").addEventListener("dblclick", (event) => {
                if (hasClosestByClassName(event.target as HTMLElement, "fullscreen")) {
                    if (currentWindow.isMaximized()) {
                        currentWindow.unmaximize();
                    } else {
                        currentWindow.maximize();
                    }
                }
            });
        }
        /// #endif
    }

    private showMenu(protyle: IProtyle, position: { x: number, y: number }) {
        let id;
        const cursorNodeElement = hasClosestBlock(getEditorRange(protyle.element).startContainer);
        if (cursorNodeElement) {
            id = cursorNodeElement.getAttribute("data-node-id");
        }
        fetchPost("/api/block/getBlockWordCount", {id: id || protyle.block.id}, (response) => {
            window.siyuan.menus.menu.remove();

            if (!protyle.contentElement.classList.contains("fn__none")) {
                let uploadHTML = "";
                if (!protyle.disabled) {
                    uploadHTML = '<input class="b3-form__upload" type="file" multiple="multiple"';
                    if (protyle.options.upload.accept) {
                        uploadHTML += ` accept="${protyle.options.upload.accept}">`;
                    } else {
                        uploadHTML += ">";
                    }
                }
                const uploadMenu = new MenuItem({
                    disabled: protyle.disabled,
                    icon: "iconDownload",
                    label: `${window.siyuan.languages.insertAsset}${uploadHTML}`,
                }).element;
                if (!protyle.disabled) {
                    uploadMenu.querySelector("input").addEventListener("change", (event: InputEvent & { target: HTMLInputElement }) => {
                        if (event.target.files.length === 0) {
                            return;
                        }
                        uploadFiles(protyle, event.target.files, event.target);
                        window.siyuan.menus.menu.remove();
                    });
                }
                window.siyuan.menus.menu.append(uploadMenu);
                if (window.siyuan.config.system.container !== "android" || !window.JSAndroid) {
                    window.siyuan.menus.menu.append(new MenuItem({
                        disabled: protyle.disabled && (!this.mediaRecorder || (this.mediaRecorder && !this.mediaRecorder.isRecording)),
                        current: this.mediaRecorder && this.mediaRecorder.isRecording,
                        icon: "iconRecord",
                        label: this.mediaRecorder?.isRecording ? window.siyuan.languages.endRecord : window.siyuan.languages.startRecord,
                        click: () => {
                            let messageId = "";
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
                                    this.mediaRecorder.startRecordingNewWavFile();
                                    id = showMessage(window.siyuan.languages.recording, -1);
                                }).catch(() => {
                                    showMessage(window.siyuan.languages["record-tip"]);
                                });
                                return;
                            }

                            if (this.mediaRecorder.isRecording) {
                                this.mediaRecorder.stopRecording();
                                hideMessage(messageId);
                                const file: File = new File([this.mediaRecorder.buildWavFileBlob()],
                                    `record${(new Date()).getTime()}.wav`, {type: "video/webm"});
                                uploadFiles(protyle, [file]);
                            } else {
                                hideMessage(messageId);
                                messageId = showMessage(window.siyuan.languages.recording, -1);
                                this.mediaRecorder.startRecordingNewWavFile();
                            }
                        }
                    }).element);
                }
            }
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.uploadAssets2CDN,
                icon: "iconCloud",
                click() {
                    if (!needSubscribe()) {
                        fetchPost("/api/asset/uploadCloud", {id: protyle.block.parentID});
                    }
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.spaceInZE,
                click: () => {
                    fetchPost("/api/format/autoSpace", {
                        id: protyle.block.rootID
                    }, () => {
                        if (isMobile()) {
                            fetchPost("/api/filetree/getDoc", {
                                id: protyle.block.id,
                                mode: 0,
                                size: Constants.SIZE_GET,
                            }, getResponse => {
                                onGet(getResponse, protyle, [Constants.CB_GET_FOCUS]);
                            });
                        } else {
                            getAllModels().editor.forEach(item => {
                                if (item.editor.protyle.block.rootID === protyle.block.rootID) {
                                    fetchPost("/api/filetree/getDoc", {
                                        id: item.editor.protyle.block.rootID,
                                        mode: 0,
                                        size: Constants.SIZE_GET,
                                    }, getResponse => {
                                        onGet(getResponse, item.editor.protyle, [Constants.CB_GET_FOCUS]);
                                    });
                                }
                            });
                        }
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.netImg2LocalAsset,
                click: () => {
                    fetchPost("/api/format/netImg2LocalAssets", {
                        id: protyle.block.rootID
                    }, () => {
                        if (isMobile()) {
                            fetchPost("/api/filetree/getDoc", {
                                id: protyle.block.id,
                                mode: 0,
                                size: Constants.SIZE_GET,
                            }, getResponse => {
                                onGet(getResponse, protyle, [Constants.CB_GET_FOCUS]);
                            });
                        } else {
                            getAllModels().editor.forEach(item => {
                                if (item.editor.protyle.block.rootID === protyle.block.rootID) {
                                    fetchPost("/api/filetree/getDoc", {
                                        id: item.editor.protyle.block.rootID,
                                        mode: 0,
                                        size: Constants.SIZE_GET,
                                    }, getResponse => {
                                        onGet(getResponse, item.editor.protyle, [Constants.CB_GET_FOCUS]);
                                    });
                                }
                            });
                        }
                    });
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconRefresh",
                accelerator: window.siyuan.config.keymap.editor.general.refresh.custom,
                label: window.siyuan.languages.refresh,
                click: () => {
                    protyle.title?.render(protyle, true);
                    fetchPost("/api/filetree/getDoc", {
                        id: protyle.block.showAll ? protyle.block.id : protyle.block.rootID,
                        mode: 0,
                        size: protyle.block.showAll ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
                    }, getResponse => {
                        onGet(getResponse, protyle, protyle.block.showAll ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS]);
                    });
                }
            }).element);
            if (!isMobile()) {
                window.siyuan.menus.menu.append(new MenuItem({
                    icon: "iconFullscreen",
                    accelerator: window.siyuan.config.keymap.editor.general.fullscreen.custom,
                    label: window.siyuan.languages.fullscreen,
                    click: () => {
                        fullscreen(protyle.element);
                        setPadding(protyle);
                    }
                }).element);
            }
            const editSubmenu: IMenu[] = [{
                current: !protyle.contentElement.classList.contains("fn__none"),
                label: window.siyuan.languages.wysiwyg,
                accelerator: window.siyuan.config.keymap.editor.general.wysiwyg.custom,
                click: () => {
                    setEditMode(protyle, "wysiwyg");
                    protyle.scroll.lastScrollTop = 0;
                    fetchPost("/api/filetree/getDoc", {
                        id: protyle.block.rootID,
                        size: Constants.SIZE_GET,
                    }, getResponse => {
                        onGet(getResponse, protyle);
                        window.siyuan.menus.menu.remove();
                    });
                }
            }];
            editSubmenu.push({
                current: !protyle.preview.element.classList.contains("fn__none"),
                icon: "iconPreview",
                label: window.siyuan.languages.preview,
                accelerator: window.siyuan.config.keymap.editor.general.preview.custom,
                click: () => {
                    setEditMode(protyle, "preview");
                    window.siyuan.menus.menu.remove();
                }
            });
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconEdit",
                label: window.siyuan.languages["edit-mode"],
                type: "submenu",
                submenu: editSubmenu
            }).element);
            window.siyuan.menus.menu.append(exportMd(protyle.block.parentID));
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                type: "readonly",
                label: `<div class="fn__flex">${window.siyuan.languages.docRuneCount}<span class="fn__space fn__flex-1"></span>${response.data.rootBlockRuneCount}</div>
<div class="fn__flex">${window.siyuan.languages.docWordCount}<span class="fn__space fn__flex-1"></span>${response.data.rootBlockWordCount}</div>
<div class="fn__flex">${window.siyuan.languages.blockRuneCount}<span class="fn__space fn__flex-1"></span>${response.data.blockRuneCount}</div>
<div class="fn__flex">${window.siyuan.languages.blockWordCount}<span class="fn__space fn__flex-1"></span>${response.data.blockWordCount}</div>`,
            }).element);
            window.siyuan.menus.menu.popup(position);
        });
    }

    public render(protyle: IProtyle, update = false) {
        let range: Range;
        let blockElement: Element;
        if (getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
            if (!protyle.wysiwyg.element.isEqualNode(range.startContainer) && !protyle.wysiwyg.element.contains(range.startContainer)) {
                blockElement = protyle.wysiwyg.element.firstElementChild;
            } else {
                blockElement = hasClosestBlock(range.startContainer) as Element;
            }
        }
        if (!blockElement) {
            blockElement = protyle.wysiwyg.element.firstElementChild;
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
        fetchPost("/api/block/getBlockBreadcrumb", {id}, (response) => {
            let html = "";
            response.data.forEach((item: { id: string, name: string, type: string, subType: string, children: [] }, index: number) => {
                let isCurrent = false;
                if (!protyle.block.showAll && item.id === protyle.block.parentID) {
                    isCurrent = true;
                } else if (protyle.block.showAll && item.id === protyle.block.id) {
                    isCurrent = true;
                }
                if (index === 0 && !protyle.options.render.breadcrumbDocName) {
                    html += `<span class="protyle-breadcrumb__item${isCurrent ? " protyle-breadcrumb__item--active" : ""}" data-node-id="${item.id}">
    <svg class="popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.type, item.subType)}"></use></svg>
</span>`;
                } else {
                    html += `<span class="protyle-breadcrumb__item${isCurrent ? " protyle-breadcrumb__item--active" : ""}" data-node-id="${item.id}">
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
            while (this.element.scrollHeight > 30 && !jump) {
                itemElements.find((item, index) => {
                    if (itemElements.length === 1) {
                        item.classList.add("protyle-breadcrumb__text--ellipsis");
                        jump = true;
                        return true;
                    }
                    if (!item.classList.contains("protyle-breadcrumb__text--ellipsis")) {
                        item.classList.add("protyle-breadcrumb__text--ellipsis");
                        return true;
                    }
                    if (index === itemElements.length - 1 && item.classList.contains("protyle-breadcrumb__text--ellipsis")) {
                        jump = true;
                    }
                });
            }
            this.element.classList.add("protyle-breadcrumb__bar--nowrap");
            if (this.element.lastElementChild) {
                this.element.scrollLeft = (this.element.lastElementChild as HTMLElement).offsetLeft - this.element.clientWidth - 8;
            }
        });
    }

    public hide() {
        this.element.classList.add("protyle-breadcrumb__bar--hide");
        window.siyuan.hideBreadcrumb = true;
    }

    public show() {
        this.element.classList.remove("protyle-breadcrumb__bar--hide");
        window.siyuan.hideBreadcrumb = false;
    }
}
