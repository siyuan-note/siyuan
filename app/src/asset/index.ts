import {Model} from "../layout/Model";
import {Tab} from "../layout/Tab";
import {Constants} from "../constants";
import {setPanelFocus} from "../layout/util";
/// #if !BROWSER
import {setModelsHash} from "../window/setHeader";
/// #endif
/// #if !MOBILE
// @ts-ignore
import {webViewerLoad} from "./pdf/viewer";
// @ts-ignore
import {onPageNumberChanged} from "./pdf/app";
/// #endif
import {fetchPost} from "../util/fetch";
import {setStorageVal} from "../protyle/util/compatibility";
import type {App} from "../index";
import {clearOBG} from "../layout/dock/util";
import {getDisplayName} from "../util/pathName";
import {PdfLoadState} from "./pdfLoadState";
import {getPdfViewerHTML} from "./pdf/viewerTemplate";
import {forEachPluginSubscriber} from "../plugin/EventBusCore";

export class Asset extends Model {
    public path: string;
    public element: HTMLElement;
    private pdfId: number | string;
    private pdfPage: number;
    public pdfObject: any;
    private pdfLoadState = new PdfLoadState();

    constructor(options: { app: App, tab: Tab, path: string, page?: number | string }) {
        super({app: options.app});
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            options.tab.headElement.classList.add("item--unupdate");
        }
        this.element = options.tab.panelElement;
        this.path = options.path;
        this.pdfId = options.page;
        this.element.addEventListener("click", (event) => {
            clearOBG();
            setPanelFocus(this.element.parentElement.parentElement);
            forEachPluginSubscriber("click-pdf", eventBus => {
                eventBus.emit("click-pdf", {event});
            });
        });
        if (typeof this.pdfId === "string") {
            this.getPdfId(() => {
                this.render();
            });
            return;
        } else if (typeof this.pdfId === "number") {
            this.pdfPage = this.pdfId;
        }
        this.render();
    }

    public update(path: string) {
        this.path = path;
        this.parent.updateTitle(getDisplayName(path));
        this.render(false);
    }

    private getPdfId(cb: () => void) {
        fetchPost("/api/asset/getFileAnnotation", {
            path: this.path + ".sya",
        }, (response) => {
            if (this.pdfLoadState.isDestroyed) {
                return;
            }
            if (response.code !== 1) {
                const config = JSON.parse(response.data.data);
                if (config[this.pdfId]) {
                    this.pdfPage = config[this.pdfId].page ? config[this.pdfId].page + 1 : config[this.pdfId].pages[0].index + 1;
                } else {
                    this.pdfPage = undefined;
                }
            }
            cb();
        });
    }

    public goToPage(pdfId: string | number) {
        if (typeof pdfId === "undefined" || pdfId === null) {
            return;
        }
        this.pdfId = pdfId;
        /// #if !MOBILE
        if (typeof pdfId === "string") {
            this.getPdfId(() => {
                if (this.pdfPage) {
                    onPageNumberChanged({value: this.pdfPage, pdfInstance: this.pdfObject, id: this.pdfId});
                }
            });
            return;
        }
        if (typeof pdfId === "number" && !isNaN(pdfId)) {
            onPageNumberChanged({value: this.pdfId, pdfInstance: this.pdfObject});
        }
        /// #endif
    }

    private render(isInit = true) {
        if (this.pdfLoadState.isDestroyed) {
            return;
        }
        this.pdfLoadState.clearPending();
        if (!isInit && this.pdfObject) {
            void this.pdfObject.destroy();
            this.pdfObject = undefined;
        }
        const type = this.path.substr(this.path.lastIndexOf(".")).toLowerCase().split("?")[0];
        // 对资源路径进行 HTML 转义后再拼入 src 属性，避免路径中包含 " 等字符导致属性逃逸引发 XSS
        const src = Lute.EscapeHTMLStr(this.path.startsWith("file") ? this.path : document.getElementById("baseURL").getAttribute("href") + "/" + this.path);
        if (Constants.SIYUAN_ASSETS_IMAGE.includes(type)) {
            this.element.innerHTML = `<div class="asset"><img src="${src}"></div>`;
        } else if (Constants.SIYUAN_ASSETS_AUDIO.includes(type)) {
            this.element.innerHTML = `<div class="asset"><audio controls="controls" src="${src}"></audio></div>`;
        } else if (Constants.SIYUAN_ASSETS_VIDEO.includes(type)) {
            this.element.innerHTML = `<div class="asset"><video controls="controls" src="${src}"></video></div>`;
        } else if (type === ".pdf") {
            /// #if !MOBILE
            this.element.innerHTML = getPdfViewerHTML();
            const localPDF = window.siyuan.storage[Constants.LOCAL_PDFTHEME];
            const pdfTheme = window.siyuan.config.appearance.mode === 0 ? localPDF.light : localPDF.dark;
            const darkElement = this.element.querySelector("#pdfDark");
            const lightElement = this.element.querySelector("#pdfLight");
            if (pdfTheme === "dark") {
                this.element.firstElementChild.classList.add("pdf__outer--dark");
                lightElement.classList.remove("toggled");
                darkElement.classList.add("toggled");
            } else {
                lightElement.classList.add("toggled");
                darkElement.classList.remove("toggled");
            }
            lightElement.addEventListener("click", () => {
                if (window.siyuan.config.appearance.mode === 0) {
                    localPDF.light = "light";
                } else {
                    localPDF.dark = "light";
                }
                this.element.firstElementChild.classList.remove("pdf__outer--dark");
                lightElement.classList.add("toggled");
                darkElement.classList.remove("toggled");
                setStorageVal(Constants.LOCAL_PDFTHEME, window.siyuan.storage[Constants.LOCAL_PDFTHEME]);
            });
            darkElement.addEventListener("click", () => {
                if (window.siyuan.config.appearance.mode === 0) {
                    localPDF.light = "dark";
                } else {
                    localPDF.dark = "dark";
                }
                this.element.firstElementChild.classList.add("pdf__outer--dark");
                lightElement.classList.remove("toggled");
                darkElement.classList.add("toggled");
                setStorageVal(Constants.LOCAL_PDFTHEME, window.siyuan.storage[Constants.LOCAL_PDFTHEME]);
            });
            // 初始化完成后需等待页签是否显示设置完成，才可以判断 pdf 是否能进行渲染
            this.pdfLoadState.setTimeout(window.setTimeout(() => {
                if (!this.pdfLoadState.consumeTimeout() || !this.element.isConnected) {
                    return;
                }
                if (this.element.clientWidth === 0) {
                    const observer = new MutationObserver(() => {
                        if (!this.pdfLoadState.consumeObserver()) {
                            return;
                        }
                        this.loadPdf();
                    });
                    if (this.pdfLoadState.setObserver(observer)) {
                        observer.observe(this.element, {attributeFilter: ["class"]});
                    }
                } else {
                    this.loadPdf();
                }
                /// #if !BROWSER
                setModelsHash();
                /// #endif
            }, Constants.TIMEOUT_LOAD));
            /// #endif
        }
    }

    private loadPdf() {
        if (this.pdfLoadState.isDestroyed || !this.element.isConnected) {
            return;
        }
        this.pdfObject = webViewerLoad(this.path.startsWith("file") ? this.path : document.getElementById("baseURL").getAttribute("href") + "/" + this.path,
            this.element, this.pdfPage, this.pdfId);
        this.element.setAttribute("data-loading", "true");
    }

    public destroy() {
        if (!this.pdfLoadState.destroy()) {
            return;
        }
        if (this.pdfObject) {
            void this.pdfObject.destroy();
        }
        this.pdfObject = undefined;
    }
}
