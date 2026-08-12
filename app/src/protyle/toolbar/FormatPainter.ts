import {Constants} from "../../constants";
import {MenuItem} from "../../menus/Menu";
import {getBlockRanges} from "../util/selection";
import {
    FORMAT_PAINTER_TYPES,
    getCommonFormatPainterSnapshot,
    IFormatPainterSegment,
    IFormatPainterSnapshot,
    IFormatPainterStyle,
} from "./formatPainterCore";

export type TFormatPainterMode = "once" | "continuous";

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
        this.renderStatus();
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
        if (this.mode === "once") {
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
        document.getElementById("statusFormatPainter")?.remove();
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
            element.innerHTML = '<svg><use xlink:href="#iconFormat"></use></svg>';
            element.addEventListener("click", () => this.deactivate());
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

    constructor(protyle: IProtyle, menuItem: IMenuItem) {
        this.element = document.createElement("div");
        this.element.className = "protyle-toolbar__format-painter";

        const buttonElement = document.createElement("button");
        buttonElement.className = "protyle-toolbar__item b3-tooltips b3-tooltips__n";
        buttonElement.setAttribute("data-type", menuItem.name);
        buttonElement.setAttribute("aria-label", window.siyuan.languages.formatPainter);
        buttonElement.innerHTML = '<svg><use xlink:href="#iconFormat"></use></svg>';
        buttonElement.addEventListener("mousedown", event => event.preventDefault());
        buttonElement.addEventListener("click", event => {
            event.preventDefault();
            formatPainter.activate(protyle, "once");
        });

        const menuElement = document.createElement("button");
        menuElement.className = "protyle-toolbar__item protyle-toolbar__format-painter-menu " +
            "b3-tooltips b3-tooltips__n";
        menuElement.setAttribute("aria-label", window.siyuan.languages.formatPainterContinuous);
        menuElement.innerHTML = '<svg><use xlink:href="#iconDown"></use></svg>';
        menuElement.addEventListener("mousedown", event => event.preventDefault());
        menuElement.addEventListener("click", event => {
            event.preventDefault();
            window.siyuan.menus.menu.remove();
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconFormat",
                label: window.siyuan.languages.formatPainterContinuous,
                click: () => formatPainter.activate(protyle, "continuous"),
            }).element);
            const rect = menuElement.getBoundingClientRect();
            window.siyuan.menus.menu.popup({x: rect.left, y: rect.bottom, h: rect.height});
        });

        this.element.append(buttonElement, menuElement);
    }
}
