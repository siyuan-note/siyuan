import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {isMobile} from "../../util/functions";

const HEADING_SELECTOR = '[data-node-id][data-type="NodeHeading"][data-subtype]';
const NUMBERED_HEADING_SELECTOR = '[data-node-id][data-type="NodeHeading"][data-heading-number]';
const STYLE_SELECTOR = 'style[data-type="heading-number"]';
const HEADING_NUMBER_CONTAINER_CLASS = "protyle-wysiwyg--heading-number";
const HEADING_NUMBER_GUTTER_CLASS = "protyle-wysiwyg--heading-number-gutter";
const REFRESH_DELAY = 300;
const HEADING_NUMBER_GAP = 8;
const HEADING_NUMBER_FOLDED_GAP = 6;
const HEADING_NUMBER_FOLDED_MARKER_WIDTH = 16;
const HEADING_NUMBER_MAX_WIDTH = 96;
const HEADING_NUMBER_MIN_WIDTH = 8;
const HEADING_NUMBER_MIN_FONT_SIZE = 1;
const HEADING_NUMBER_MIN_GUTTER = 48;

const refreshTimers: Record<string, number> = {};
const refreshVersions: Record<string, number> = {};
let measureCanvas: HTMLCanvasElement;

const escapeCSSString = (value: string) => {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ");
};

const getStyleElement = (protyle: IProtyle) => {
    let styleElement = protyle.element.querySelector<HTMLStyleElement>(STYLE_SELECTOR);
    if (!styleElement) {
        styleElement = document.createElement("style");
        styleElement.dataset.type = "heading-number";
        protyle.element.append(styleElement);
    }
    return styleElement;
};

const getHeadingLevel = (heading: Element) => {
    const match = heading.getAttribute("data-subtype")?.match(/^h([1-6])$/);
    return match ? parseInt(match[1]) : 0;
};

const clearHeadingNumberStyle = (item: Element) => {
    if (item instanceof HTMLElement) {
        item.style.removeProperty("--b3-heading-number-font-size");
        item.style.removeProperty("--b3-heading-number-gap");
        item.style.removeProperty("--b3-heading-number-folded-gap");
        item.style.removeProperty("--b3-heading-number-folded-marker-width");
        item.style.removeProperty("--b3-heading-number-width");
        if (item.getAttribute("style") === "") {
            item.removeAttribute("style");
        }
    }
};

const clearHeadingNumber = (item: Element) => {
    item.removeAttribute("data-heading-number");
    item.classList.remove(HEADING_NUMBER_GUTTER_CLASS);
    clearHeadingNumberStyle(item);
};

const cleanupHeadingNumber = (protyle: IProtyle) => {
    protyle.wysiwyg.element.querySelectorAll(NUMBERED_HEADING_SELECTOR).forEach(item => {
        clearHeadingNumber(item);
    });
    protyle.wysiwyg.element.classList.remove(HEADING_NUMBER_CONTAINER_CLASS);
    protyle.wysiwyg.element.removeAttribute("data-heading-number-style-id");
    const styleElement = protyle.element.querySelector<HTMLStyleElement>(STYLE_SELECTOR);
    if (styleElement) {
        styleElement.textContent = "";
    }
};

const isNumberableHeading = (item: Element) => {
    return !item.closest(".bq, .callout, .protyle-wysiwyg__embed") &&
        !!item.getAttribute("data-node-id") &&
        getHeadingLevel(item) > 0;
};

const fallbackVisibleNumbers = (headings: Element[]) => {
    const ret: Record<string, string> = {};
    const counters = [0, 0, 0, 0, 0, 0];
    const validHeadings = headings.filter(item => isNumberableHeading(item));
    if (validHeadings.length === 0) {
        return ret;
    }
    const minLevel = Math.min(...validHeadings.map(item => getHeadingLevel(item)));

    validHeadings.forEach(item => {
        const id = item.getAttribute("data-node-id");
        const level = getHeadingLevel(item) - minLevel + 1;
        counters[level - 1]++;
        for (let index = level; index < counters.length; index++) {
            counters[index] = 0;
        }
        ret[id as string] = counters.slice(0, level).join(".");
    });
    return ret;
};

const hasHeadingNumberGutter = (protyle: IProtyle) => {
    const paddingLeft = parseFloat(protyle.wysiwyg.element.style.paddingLeft ||
        window.getComputedStyle(protyle.wysiwyg.element).paddingLeft);
    return !isNaN(paddingLeft) && paddingLeft >= HEADING_NUMBER_MIN_GUTTER;
};

const measureHeadingNumber = (number: string, fontSize: number, fontFamily: string) => {
    if (!measureCanvas) {
        measureCanvas = document.createElement("canvas");
    }
    const context = measureCanvas.getContext("2d");
    if (!context) {
        return number.length * fontSize * .6;
    }
    context.font = `600 ${fontSize}px ${fontFamily}`;
    return context.measureText(number).width;
};

const resizeHeadingNumber = (protyle: IProtyle, heading: HTMLElement, number: string) => {
    const protyleRect = protyle.wysiwyg.element.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const isFolded = heading.getAttribute("fold") === "1";
    const gap = isFolded ? HEADING_NUMBER_FOLDED_GAP : HEADING_NUMBER_GAP;
    const minWidth = isFolded ? HEADING_NUMBER_MIN_FONT_SIZE : HEADING_NUMBER_MIN_WIDTH;
    let availableWidth = HEADING_NUMBER_MAX_WIDTH;
    if (protyleRect.width > 0 && headingRect.width > 0) {
        const reservedWidth = isFolded ? HEADING_NUMBER_FOLDED_MARKER_WIDTH + gap : gap;
        availableWidth = Math.min(
            HEADING_NUMBER_MAX_WIDTH,
            Math.max(minWidth, Math.floor(headingRect.left - protyleRect.left - reservedWidth - 1))
        );
    }

    const style = window.getComputedStyle(protyle.wysiwyg.element);
    const baseFontSize = parseFloat(style.fontSize) || window.siyuan.config.editor.fontSize || 16;
    const fontFamily = style.fontFamily || "sans-serif";
    const textWidth = measureHeadingNumber(number, baseFontSize, fontFamily);
    const fontSize = textWidth > availableWidth ?
        Math.max(HEADING_NUMBER_MIN_FONT_SIZE, Math.floor(baseFontSize * availableWidth / textWidth * 100) / 100) :
        baseFontSize;
    const numberWidth = textWidth > availableWidth ?
        availableWidth :
        Math.min(availableWidth, Math.max(minWidth, Math.ceil(textWidth)));

    return {
        fontSize,
        foldedGap: HEADING_NUMBER_FOLDED_GAP,
        foldedMarkerWidth: HEADING_NUMBER_FOLDED_MARKER_WIDTH,
        gap: HEADING_NUMBER_GAP,
        width: numberWidth,
    };
};

const cleanHeadingNumberState = (item: Element) => {
    clearHeadingNumber(item);
    item.classList.remove(HEADING_NUMBER_CONTAINER_CLASS);
    item.removeAttribute("data-heading-number-style-id");
};

const cleanHeadingNumberRoot = (root: DocumentFragment | Element) => {
    if (root instanceof Element) {
        cleanHeadingNumberState(root);
    }
    root.querySelectorAll(`${NUMBERED_HEADING_SELECTOR}, .${HEADING_NUMBER_GUTTER_CLASS}, .${HEADING_NUMBER_CONTAINER_CLASS}, [data-heading-number-style-id], [style*="--b3-heading-number"]`).forEach(item => {
        cleanHeadingNumberState(item);
    });
};

export const cleanHeadingNumberHTML = (html: string) => {
    if (html.indexOf("data-heading-number=") === -1 &&
        html.indexOf("data-heading-number-style-id=") === -1 &&
        html.indexOf(HEADING_NUMBER_GUTTER_CLASS) === -1 &&
        html.indexOf(HEADING_NUMBER_CONTAINER_CLASS) === -1 &&
        html.indexOf("--b3-heading-number") === -1) {
        return html;
    }

    const template = document.createElement("template");
    template.innerHTML = html;
    cleanHeadingNumberRoot(template.content);
    return template.innerHTML;
};

export const renderHeadingNumber = (protyle: IProtyle, headingNumbers?: Record<string, string> | null) => {
    if (undefined !== headingNumbers) {
        protyle.block.headingNumbers = headingNumbers || {};
    }

    protyle.wysiwyg.element.dataset.headingNumberStyleId = protyle.id;
    const headings = Array.from(protyle.wysiwyg.element.querySelectorAll(HEADING_SELECTOR));

    if (!window.siyuan.config.editor.headingNumber ||
        isMobile() ||
        !hasHeadingNumberGutter(protyle) ||
        protyle.options.backlinkData ||
        protyle.options.action.includes(Constants.CB_GET_HISTORY)) {
        cleanupHeadingNumber(protyle);
        return;
    }

    const numbers = protyle.block.headingNumbers === undefined ? fallbackVisibleNumbers(headings) : protyle.block.headingNumbers || {};
    const styleRules: string[] = [];
    protyle.wysiwyg.element.classList.add(HEADING_NUMBER_CONTAINER_CLASS);
    headings.forEach(item => {
        if (!isNumberableHeading(item)) {
            clearHeadingNumber(item);
            return;
        }
        const id = item.getAttribute("data-node-id");
        const number = id ? numbers[id] : "";
        if (!number) {
            clearHeadingNumber(item);
            return;
        }

        clearHeadingNumberStyle(item);
        const sizing = resizeHeadingNumber(protyle, item as HTMLElement, number);
        styleRules.push(`.protyle-wysiwyg--heading-number[data-heading-number-style-id="${escapeCSSString(protyle.id)}"] [data-node-id="${escapeCSSString(id)}"][data-type="NodeHeading"][data-heading-number]{--b3-heading-number-font-size:${sizing.fontSize}px;--b3-heading-number-gap:${sizing.gap}px;--b3-heading-number-folded-gap:${sizing.foldedGap}px;--b3-heading-number-folded-marker-width:${sizing.foldedMarkerWidth}px;--b3-heading-number-width:${sizing.width}px;}`);
        item.setAttribute("data-heading-number", number);
    });
    getStyleElement(protyle).textContent = styleRules.join("");
};

const operationDataHasHeading = (data: string) => {
    const template = document.createElement("template");
    template.innerHTML = data;
    return !!template.content.querySelector('[data-type="NodeHeading"]');
};

export const operationMayChangeHeadingNumber = (operation: IOperation, headingNumbers?: Record<string, string> | null) => {
    if (["append", "delete", "move", "moveOutlineHeading"].includes(operation.action)) {
        return true;
    }
    if (!["appendInsert", "insert", "prependInsert", "update"].includes(operation.action) || typeof operation.data !== "string") {
        return false;
    }
    if (operation.action === "update" && operation.id && headingNumbers?.[operation.id]) {
        return true;
    }

    return operationDataHasHeading(operation.data);
};

export const queueHeadingNumberRefresh = (protyle: IProtyle) => {
    if (!window.siyuan.config.editor.headingNumber || protyle.options.backlinkData || !protyle.block.rootID) {
        renderHeadingNumber(protyle);
        return;
    }

    window.clearTimeout(refreshTimers[protyle.id]);
    const rootID = protyle.block.rootID;
    const refreshVersion = (refreshVersions[protyle.id] || 0) + 1;
    refreshVersions[protyle.id] = refreshVersion;
    refreshTimers[protyle.id] = window.setTimeout(() => {
        fetchPost("/api/filetree/getDoc", {
            id: rootID,
            size: 1,
        }, response => {
            if (!document.body.contains(protyle.element) ||
                protyle.block.rootID !== rootID ||
                refreshVersions[protyle.id] !== refreshVersion) {
                return;
            }
            renderHeadingNumber(protyle, response.data?.headingNumbers ?? null);
        });
    }, REFRESH_DELAY);
};

export const clearHeadingNumberGutter = (element: Element | Document = document) => {
    element.querySelectorAll(`.${HEADING_NUMBER_GUTTER_CLASS}`).forEach(item => {
        item.classList.remove(HEADING_NUMBER_GUTTER_CLASS);
    });
};
