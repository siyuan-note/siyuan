import type {FileTreeGetDocRequestInput} from "../../types/api";
import {Constants} from "../../constants";
import {onGet} from "../util/onGet";
import {fetchPost} from "../../util/fetch";
import {updateHotkeyTip} from "../util/compatibility";
import {hasClosestByClassName} from "../util/hasClosest";
import {goEnd, goHome} from "../wysiwyg/commonHotkey";
import {showTooltip} from "../../dialog/tooltip";
import {isEncryptedBox} from "../../util/pathName";
import {updateScrollVisibility} from "./visibility";
import {hideMessage, showMessage} from "../../dialog/message";
import {isDocumentBoundaryLoaded, markDocumentBoundaryLoaded} from "../util/documentRange";
import {isDocumentBlockCountCovered, loadUntilDocumentBoundary} from "./loadAll";
import {
    DynamicLoadState,
    type IDynamicLoadRequest,
    type TDynamicLoadMode
} from "./dynamicLoadState";
import {saveScroll} from "./saveScroll";
import {getScrollIndexFromPointer} from "./slider";
import {refreshSyntheticDragTarget} from "../../util/touchDragBridge";
import {waitForPendingTransactions} from "../util/transactionQueue";
import {getKeymapBindings} from "../../util/keymapBindings";
import {scrollPageWithLoading} from "./page";
import {isPageScrollButtonsEnabled, PAGE_SCROLL_BUTTONS_CHANGED_EVENT} from "./pageButtons";

export class Scroll {
    public element: HTMLElement;
    private parentElement: HTMLElement;
    private inputElement: HTMLInputElement;
    private dynamicLoadState = new DynamicLoadState();
    private dynamicLoadAbortController?: AbortController;
    private dynamicLoadFinish?: (success: boolean) => void;
    private indexAbortController?: AbortController;
    private indexRequestID = 0;
    private loadingAll = false;
    public lastScrollTop: number;
    public keepLoadedContent: boolean;   // 保持加载内容

    constructor(protyle: IProtyle) {
        this.parentElement = document.createElement("div");
        this.parentElement.classList.add("protyle-scroll", "fn__none");
        this.parentElement.innerHTML = `<div class="protyle-scroll__up ariaLabel" data-position="north">
    <svg><use xlink:href="#iconUp"></use></svg>
</div>
<div class="protyle-scroll__bar ariaLabel" data-position="2west" aria-label="Blocks 1/1">
    <input class="b3-slider" type="range" max="1" min="1" step="1" value="1" />
</div>
<div class="protyle-scroll__down ariaLabel">
    <svg><use xlink:href="#iconDown"></use></svg>
</div>
<div class="protyle-scroll__page fn__none">
    <button type="button" data-direction="up" class="block__icon block__icon--show block__icon--touch ariaLabel" data-position="west">
        <svg class="protyle-scroll__page-up"><use xlink:href="#iconArrowDown"></use></svg>
    </button>
    <button type="button" data-direction="down" class="block__icon block__icon--show block__icon--touch ariaLabel" data-position="west">
        <svg><use xlink:href="#iconArrowDown"></use></svg>
    </button>
</div>`;
        this.updateHotkeyLabels();

        const pageElement = this.parentElement.querySelector<HTMLElement>(".protyle-scroll__page");
        const updatePageButtons = () => {
            const enabled = !!protyle.options.render.scroll && isPageScrollButtonsEnabled();
            pageElement.classList.toggle("fn__none", !enabled);
            const changed = protyle.element.classList.contains("protyle--page-scroll") !== enabled;
            protyle.element.classList.toggle("protyle--page-scroll", enabled);
            if (changed && protyle.contentElement) {
                protyle.getInstance().resize();
            }
        };
        pageElement.addEventListener(PAGE_SCROLL_BUTTONS_CHANGED_EVENT, updatePageButtons);
        updatePageButtons();
        // 阻止鼠标和触屏按下时转移焦点，保留正文选区并避免唤起软键盘。
        pageElement.addEventListener("pointerdown", event => {
            event.preventDefault();
            event.stopPropagation();
        });
        pageElement.addEventListener("click", event => {
            event.stopPropagation();
            const button = (event.target as Element).closest<HTMLButtonElement>("button[data-direction]");
            if (!button || pageElement.classList.contains("fn__none")) {
                return;
            }
            scrollPageWithLoading(protyle, button.dataset.direction === "up" ? "up" : "down");
        });

        this.element = this.parentElement.querySelector(".protyle-scroll__bar");
        this.element.classList.add("fn__none");
        this.keepLoadedContent = window.siyuan.config.editor.keepLoadedContent;
        this.lastScrollTop = 0;
        this.inputElement = this.element.firstElementChild as HTMLInputElement;
        this.inputElement.addEventListener("input", () => {
            this.updateLabel(protyle);
            showTooltip(this.element.getAttribute("aria-label"), this.element);
        });
        this.inputElement.addEventListener("change", () => {
            this.setIndex(protyle);
        });
        /// #if MOBILE
        let activePointerID: number | undefined;
        const updatePointerIndex = (clientY: number) => {
            const index = getScrollIndexFromPointer(
                clientY,
                this.inputElement.getBoundingClientRect(),
                parseInt(this.inputElement.min),
                parseInt(this.inputElement.max),
            );
            if (this.inputElement.value !== index.toString()) {
                this.inputElement.value = index.toString();
                this.updateLabel(protyle);
                showTooltip(this.element.getAttribute("aria-label"), this.element);
            }
        };
        this.inputElement.addEventListener("pointerdown", (event) => {
            if (event.pointerType === "mouse") {
                return;
            }
            activePointerID = event.pointerId;
            this.inputElement.setPointerCapture(event.pointerId);
            updatePointerIndex(event.clientY);
            event.preventDefault();
        });
        this.inputElement.addEventListener("pointermove", (event) => {
            if (activePointerID !== event.pointerId) {
                return;
            }
            updatePointerIndex(event.clientY);
            event.preventDefault();
        });
        const releasePointer = (event: PointerEvent) => {
            if (activePointerID !== event.pointerId) {
                return false;
            }
            if (this.inputElement.hasPointerCapture(event.pointerId)) {
                this.inputElement.releasePointerCapture(event.pointerId);
            }
            activePointerID = undefined;
            return true;
        };
        const finishPointer = (event: PointerEvent) => {
            if (activePointerID !== event.pointerId) {
                return;
            }
            updatePointerIndex(event.clientY);
            releasePointer(event);
            this.setIndex(protyle);
            event.preventDefault();
        };
        this.inputElement.addEventListener("pointerup", finishPointer);
        this.inputElement.addEventListener("pointercancel", (event) => {
            if (releasePointer(event)) {
                event.preventDefault();
            }
        });
        /// #endif
        this.parentElement.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (hasClosestByClassName(target, "protyle-scroll__up")) {
                goHome(protyle, false);
            } else if (hasClosestByClassName(target, "protyle-scroll__down")) {
                goEnd(protyle, false);
            } else if (target.classList.contains("b3-slider")) {
                this.setIndex(protyle);
            }
        });
        this.parentElement.addEventListener("mousewheel", (event: WheelEvent) => {
            if (event.deltaY !== 0 && protyle.scroll.lastScrollTop !== -1) {
                protyle.contentElement.scrollTop += event.deltaY;
            }
        }, {passive: true});
    }

    public loadDynamic(protyle: IProtyle, mode: TDynamicLoadMode, options?: {
        beforeApply?: () => void,
        onFinish?: (success: boolean) => void,
        size?: number,
        suppressFocus?: boolean,
    }) {
        const anchorElement = mode === 1 ?
            protyle.wysiwyg.element.firstElementChild : protyle.wysiwyg.element.lastElementChild;
        const anchorID = anchorElement?.getAttribute("data-node-id");
        const rootID = protyle.block.rootID;
        const eof = mode === 1 ? anchorElement?.getAttribute("data-eof") === "1" :
            protyle.wysiwyg.element.hasAttribute("data-bottom-eof");
        if (!anchorID || !rootID || eof) {
            return false;
        }
        // 同一编辑器的动态加载需要串行，避免相同边界响应被重复追加 https://github.com/siyuan-note/siyuan/issues/18459
        const request = this.dynamicLoadState.begin(rootID, anchorID, mode);
        if (!request) {
            return false;
        }

        const abortController = new AbortController();
        this.dynamicLoadAbortController = abortController;
        this.dynamicLoadFinish = options?.onFinish;
        protyle.wysiwyg.element.setAttribute("data-top", protyle.contentElement.scrollTop.toString());
        const getDocParam: FileTreeGetDocRequestInput = {
            id: anchorID,
            mode,
            size: options?.size || window.siyuan.config.editor.dynamicLoadBlocks,
        };
        if (isEncryptedBox(protyle.notebookId)) {
            getDocParam.notebook = protyle.notebookId;
        }
        let success = false;
        void fetchPost("/api/filetree/getDoc", getDocParam, getResponse => {
            const currentAnchor = mode === 1 ?
                protyle.wysiwyg.element.firstElementChild : protyle.wysiwyg.element.lastElementChild;
            const currentAnchorID = currentAnchor?.getAttribute("data-node-id");
            if (!protyle.element.isConnected ||
                !this.dynamicLoadState.isCurrent(request, protyle.block.rootID, currentAnchorID)) {
                return;
            }
            options?.beforeApply?.();
            onGet({
                data: getResponse,
                protyle,
                suppressFocus: options?.suppressFocus,
                action: [
                    mode === 1 ? Constants.CB_GET_BEFORE : Constants.CB_GET_APPEND,
                    Constants.CB_GET_UNCHANGEID
                ],
            });
            success = getResponse.code === 0;
        }, undefined, undefined, abortController.signal).finally(() => {
            this.finishDynamicLoad(request, protyle, success);
        });
        return true;
    }

    public async loadAll(protyle: IProtyle) {
        const rootID = protyle.block.rootID;
        if (this.loadingAll || !rootID || protyle.block.showAll || !protyle.block.scroll) {
            return false;
        }

        this.loadingAll = true;
        this.invalidateDynamicLoad(protyle);
        const messageID = showMessage(window.siyuan.languages.loading, -1);
        const size = Math.max(
            window.siyuan.config.editor.dynamicLoadBlocks,
            protyle.block.blockCount || 0
        );
        try {
            const topLoaded = await this.loadUntilBoundary(protyle, rootID, 1, size);
            const bottomLoaded = topLoaded && await this.loadUntilBoundary(protyle, rootID, 2, size);
            if (!bottomLoaded || protyle.block.rootID !== rootID || !protyle.element.isConnected) {
                return false;
            }
            protyle.block.scroll = false;
            this.update(protyle);
            return true;
        } finally {
            this.loadingAll = false;
            if (messageID) {
                hideMessage(messageID);
            }
        }
    }

    public shouldKeepLoadedContent() {
        return this.keepLoadedContent || this.loadingAll;
    }

    public invalidateDynamicLoad(protyle: IProtyle) {
        if (!this.dynamicLoadState.invalidate()) {
            return;
        }
        const abortController = this.dynamicLoadAbortController;
        const onFinish = this.dynamicLoadFinish;
        this.dynamicLoadAbortController = undefined;
        this.dynamicLoadFinish = undefined;
        protyle.wysiwyg.element.removeAttribute("data-top");
        onFinish?.(false);
        abortController?.abort();
    }

    private finishDynamicLoad(request: IDynamicLoadRequest, protyle: IProtyle, success: boolean) {
        if (!this.dynamicLoadState.finish(request)) {
            return;
        }
        const onFinish = this.dynamicLoadFinish;
        this.dynamicLoadAbortController = undefined;
        this.dynamicLoadFinish = undefined;
        protyle.wysiwyg.element.removeAttribute("data-top");
        onFinish?.(success);
        refreshSyntheticDragTarget();
    }

    private async loadUntilBoundary(protyle: IProtyle, rootID: string, mode: TDynamicLoadMode, size: number) {
        const position = mode === 1 ? "before" : "after";
        return loadUntilDocumentBoundary({
            isCurrent: () => protyle.block.rootID === rootID && protyle.element.isConnected,
            isBoundaryLoaded: () => isDocumentBoundaryLoaded(protyle.wysiwyg.element, position),
            getBoundaryID: () => {
                const boundaryElement = mode === 1 ?
                    protyle.wysiwyg.element.firstElementChild : protyle.wysiwyg.element.lastElementChild;
                return boundaryElement?.getAttribute("data-node-id");
            },
            load: () => new Promise<boolean>((resolve) => {
                const requestSize = Math.max(size, protyle.block.blockCount || 0);
                const onFinish = (success: boolean) => {
                    if (success && isDocumentBlockCountCovered(requestSize, protyle.block.blockCount)) {
                        markDocumentBoundaryLoaded(protyle.wysiwyg.element, position);
                    }
                    resolve(success);
                };
                if (!this.loadDynamic(protyle, mode, {size: requestSize, onFinish})) {
                    resolve(false);
                }
            }),
        });
    }

    private setIndex(protyle: IProtyle) {
        if (protyle.wysiwyg.element.getAttribute("data-top")) {
            return;
        }
        this.cancelIndexRequest();
        protyle.wysiwyg.element.setAttribute("data-top", protyle.contentElement.scrollTop.toString());
        protyle.contentElement.style.overflow = "hidden";
        const getDocParam: FileTreeGetDocRequestInput = {
            index: parseInt(this.inputElement.value),
            id: protyle.block.parentID,
            mode: 0,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        };
        if (isEncryptedBox(protyle.notebookId)) {
            getDocParam.notebook = protyle.notebookId;
        }
        fetchPost("/api/filetree/getDoc", getDocParam, getResponse => {
            onGet({
                data: getResponse,
                protyle,
                action: [Constants.CB_GET_FOCUSFIRST, Constants.CB_GET_UNCHANGEID],
                suppressFocus: true,
                afterCB: () => {
                    setTimeout(() => {
                        protyle.contentElement.style.overflow = "";
                    }, Constants.TIMEOUT_INPUT);    // 需和 onGet 中的 preventScroll 保持一致
                    void saveScroll(protyle);
                    showTooltip(this.element.getAttribute("aria-label"), this.element);
                }
            });
        });
    }

    public async updateIndex(protyle: IProtyle, id: string, cb?: (index: number) => void) {
        const requestID = ++this.indexRequestID;
        this.indexAbortController?.abort();
        const abortController = new AbortController();
        this.indexAbortController = abortController;
        const rootID = protyle.block.rootID;
        await waitForPendingTransactions(protyle);
        if (abortController.signal.aborted || rootID !== protyle.block.rootID) {
            return;
        }
        void fetchPost("/api/block/getBlockIndex", {id}, (response) => {
            if (requestID !== this.indexRequestID || rootID !== protyle.block.rootID) {
                return;
            }
            if (!response.data) {
                return;
            }
            protyle.scroll.setCurrentIndex(protyle, response.data);
            if (cb) {
                cb(response.data);
            }
        }, undefined, undefined, abortController.signal).finally(() => {
            if (this.indexAbortController === abortController) {
                this.indexAbortController = undefined;
            }
        });
    }

    public updateHotkeyLabels() {
        const keymap = window.siyuan.config.keymap.editor.general;
        [
            {selector: ".protyle-scroll__up", key: "goToDocumentStart"},
            {selector: ".protyle-scroll__down", key: "goToDocumentEnd"},
            {selector: '.protyle-scroll__page [data-direction="up"]', key: "scrollPageUpWithoutMovingCaret", label: "pageScrollUp"},
            {selector: '.protyle-scroll__page [data-direction="down"]', key: "scrollPageDownWithoutMovingCaret", label: "pageScrollDown"},
        ].forEach(({selector, key, label}) => {
            const hotkeys = getKeymapBindings(keymap[key]).map(updateHotkeyTip).join(" / ");
            this.parentElement.querySelector(selector).setAttribute("aria-label",
                window.siyuan.languages[label || key] + (hotkeys ? " " + hotkeys : ""));
        });
    }

    public update(protyle: IProtyle) {
        if (typeof protyle.block.blockCount === "number") {
            this.inputElement.setAttribute("max", protyle.block.blockCount.toString());
            this.element.setAttribute("aria-label", `Blocks ${this.inputElement.value}/${protyle.block.blockCount}`);
        }
        const containerVisible = protyle.options.render.scroll &&
            !protyle.contentElement.classList.contains("fn__none");
        const barVisible = containerVisible && !protyle.block.showAll && protyle.block.scroll;
        updateScrollVisibility(this.parentElement, this.element, containerVisible, barVisible);
    }

    public setCurrentIndex(protyle: IProtyle, index: number, cancelPending = false) {
        if (cancelPending) {
            this.cancelIndexRequest();
        }
        this.inputElement.value = Math.max(1, Math.min(protyle.block.blockCount, index)).toString();
        this.updateLabel(protyle);
    }

    private cancelIndexRequest() {
        this.indexRequestID++;
        this.indexAbortController?.abort();
        this.indexAbortController = undefined;
    }

    private updateLabel(protyle: IProtyle) {
        this.element.setAttribute("aria-label", `Blocks ${this.inputElement.value}/${protyle.block.blockCount}`);
    }
}
