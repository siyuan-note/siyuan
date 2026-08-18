import {Constants} from "../../constants";
import {showMessage} from "../../dialog/message";
import {getBlockRanges} from "../util/selection";
import {
    FORMAT_PAINTER_TYPES,
    getCommonFormatPainterSnapshot,
    IFormatPainterSegment,
    IFormatPainterSnapshot,
    IFormatPainterStyle,
    shouldKeepFormatPainterActive,
    shouldShowFormatPainterMessage,
    TFormatPainterMode,
} from "./formatPainterCore";

const getSegment = (textNode: Text, editableElement: Element) => {
    const types: string[] = [];
    const styles: IFormatPainterStyle = {};
    let element = textNode.parentElement;
    while (element && editableElement.contains(element)) {
        const elementTypes = (element.getAttribute("data-type") || "").split(" ").filter(Boolean);
        types.push(...elementTypes);
        if (elementTypes.includes("inline-math")) {
            return;
        }
        if (elementTypes.includes("text")) {
            styles.backgroundColor = styles.backgroundColor || element.style.backgroundColor || undefined;
            styles.color = styles.color || element.style.color || undefined;
            styles.fontSize = styles.fontSize || element.style.fontSize || undefined;
            styles.shadow = styles.shadow || !!element.style.textShadow || undefined;
            styles.hollow = styles.hollow || !!element.style.webkitTextStroke || undefined;
        }
        if (element === editableElement) {
            break;
        }
        element = element.parentElement;
    }
    return {
        styles,
        types: [...new Set(types)].filter(type => FORMAT_PAINTER_TYPES.includes(type)),
    };
};

export const getFormatPainterSnapshot = (rootElement: Element, range: Range) => {
    const segments: IFormatPainterSegment[] = [];
    getBlockRanges(rootElement, range, ["NodeCodeBlock", "NodeAttributeView"]).forEach(item => {
        const walker = document.createTreeWalker(item.editableElement, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode() as Text;
        while (textNode) {
            if (item.range.intersectsNode(textNode)) {
                const start = item.range.startContainer === textNode ? item.range.startOffset : 0;
                const end = item.range.endContainer === textNode ? item.range.endOffset : textNode.data.length;
                if (start < end && textNode.data.substring(start, end).split(Constants.ZWSP).join("")) {
                    const segment = getSegment(textNode, item.editableElement);
                    if (segment) {
                        segments.push(segment);
                    }
                }
            }
            textNode = walker.nextNode() as Text;
        }
    });
    return getCommonFormatPainterSnapshot(segments);
};

class FormatPainterController {
    private mode?: TFormatPainterMode;
    private snapshot?: IFormatPainterSnapshot;
    private cursorElement?: HTMLElement;

    private moveCursor = (event: MouseEvent) => {
        if (!this.cursorElement) {
            return;
        }
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".protyle-wysiwyg[data-readonly=\"false\"]")) {
            this.cursorElement.classList.add("fn__none");
            return;
        }
        this.cursorElement.classList.remove("fn__none");
        this.cursorElement.style.transform = `translate3d(${event.clientX + 8}px, ${event.clientY + 8}px, 0)`;
    };

    private renderCursor() {
        this.removeCursor();
        this.cursorElement = document.createElement("div");
        this.cursorElement.className = "protyle-format-painter__cursor fn__none";
        this.cursorElement.innerHTML = '<svg><use xlink:href="#iconPaintRoller"></use></svg>';
        document.body.append(this.cursorElement);
        document.addEventListener("mousemove", this.moveCursor);
    }

    private removeCursor() {
        document.removeEventListener("mousemove", this.moveCursor);
        this.cursorElement?.remove();
        this.cursorElement = undefined;
    }

    private showMessage(message: string, timeout: number) {
        if (shouldShowFormatPainterMessage(window.siyuan.config.appearance.notifications?.formatPainterTip)) {
            showMessage(message, timeout, "info", "formatPainter");
        }
    }

    public isActive() {
        return !!this.mode && !!this.snapshot;
    }

    public activate(protyle: IProtyle, mode: TFormatPainterMode) {
        if (!protyle.toolbar?.range) {
            return false;
        }
        const snapshot = getFormatPainterSnapshot(protyle.wysiwyg.element, protyle.toolbar.range);
        if (!snapshot) {
            return false;
        }
        this.mode = mode;
        this.snapshot = snapshot;
        document.body.dataset.formatPainter = mode;
        this.renderCursor();
        this.renderStatus();
        this.showMessage(mode === "continuous" ? window.siyuan.languages.formatPainterContinuousActive :
            window.siyuan.languages.formatPainterActive, 4000);
        protyle.toolbar.element.classList.add("fn__none");
        return true;
    }

    public paint(protyle: IProtyle, range: Range) {
        if (!this.snapshot || !this.mode || !protyle.toolbar || protyle.disabled) {
            return;
        }
        protyle.toolbar.range = range;
        if (!protyle.toolbar.applyFormatPainter(protyle, this.snapshot)) {
            return;
        }
        const paintedRange = protyle.toolbar.range;
        protyle.toolbar.element.classList.add("fn__none");
        if (!shouldKeepFormatPainterActive(this.mode)) {
            this.deactivate();
        }
        return paintedRange;
    }

    public deactivate() {
        if (!this.isActive()) {
            return false;
        }
        this.mode = undefined;
        this.snapshot = undefined;
        delete document.body.dataset.formatPainter;
        this.removeCursor();
        document.getElementById("statusFormatPainter")?.remove();
        this.showMessage(window.siyuan.languages.formatPainterInactive, 3000);
        return true;
    }

    public deactivateByPointer(target: Element) {
        if (!this.isActive() || target.closest(".protyle-wysiwyg") || target.closest("#statusFormatPainter") ||
            target.closest('[data-type="tab-header"]')) {
            return;
        }
        this.deactivate();
    }

    private renderStatus() {
        const statusElement = document.getElementById("status");
        if (!statusElement) {
            return;
        }
        let element = document.getElementById("statusFormatPainter");
        if (!element) {
            element = document.createElement("button");
            element.id = "statusFormatPainter";
            element.className = "toolbar__item ariaLabel status__format-painter";
            element.innerHTML = '<svg><use xlink:href="#iconPaintRoller"></use></svg>';
            element.addEventListener("click", (event) => {
                event.stopPropagation();
                this.deactivate();
            });
            const helpElement = statusElement.querySelector("#statusHelp");
            if (helpElement) {
                helpElement.before(element);
            } else {
                statusElement.append(element);
            }
        }
        element.setAttribute("aria-label", this.mode === "continuous" ?
            window.siyuan.languages.formatPainterContinuousActive : window.siyuan.languages.formatPainterActive);
    }
}

export const formatPainter = new FormatPainterController();

export class FormatPainter {
    public element: HTMLElement;
    private clickTimeout?: number;

    constructor(protyle: IProtyle, menuItem: IMenuItem) {
        this.element = document.createElement("button");
        this.element.className = "protyle-toolbar__item b3-tooltips b3-tooltips__n";
        this.element.setAttribute("data-type", menuItem.name);
        this.element.setAttribute("aria-label", window.siyuan.languages.formatPainterDoubleClickTip);
        this.element.innerHTML = '<svg><use xlink:href="#iconPaintRoller"></use></svg>';
        this.element.addEventListener("mousedown", event => event.preventDefault());
        this.element.addEventListener("click", event => {
            event.preventDefault();
            clearTimeout(this.clickTimeout);
            if (event.detail > 1) {
                this.clickTimeout = undefined;
                formatPainter.activate(protyle, "continuous");
            } else if (event.detail === 0) {
                formatPainter.activate(protyle, "once");
            } else {
                this.clickTimeout = window.setTimeout(() => {
                    this.clickTimeout = undefined;
                    formatPainter.activate(protyle, "once");
                }, Constants.TIMEOUT_DBLCLICK);
            }
        });
    }
}
