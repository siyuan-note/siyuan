const HEADING_SELECTOR = '[data-node-id][data-type="NodeHeading"]';
const HEADING_NUMBER_CLASS = "protyle-heading-number";
const HEADING_NUMBER_ACTIVE_CLASS = "protyle-heading-number--active";
const HEADING_NUMBER_MEASURE_CLASS = "protyle-heading-number__measure";
const HEADING_NUMBER_WIDTH_PROPERTY = "--b3-protyle-heading-number-width";
const NUMBERED_HEADING_SELECTOR = `${HEADING_SELECTOR}[data-heading-number], ` +
    `${HEADING_SELECTOR} > [contenteditable][data-heading-number]`;
const headingNumberMeasurements = new WeakMap<Element, {key: string, offset: string}>();

export interface IHeadingNumberStyle {
    id: string;
    number: string;
    offset: string;
}

export const clearHeadingNumberElements = (root: Element) => {
    root.querySelectorAll(NUMBERED_HEADING_SELECTOR).forEach(item => {
        item.removeAttribute("data-heading-number");
    });
    root.querySelectorAll<HTMLElement>(`[style*="${HEADING_NUMBER_WIDTH_PROPERTY}"]`).forEach(item => {
        item.style.removeProperty(HEADING_NUMBER_WIDTH_PROPERTY);
    });
    root.querySelectorAll(`.${HEADING_NUMBER_CLASS}`).forEach(item => item.remove());
    root.querySelectorAll(`.${HEADING_NUMBER_ACTIVE_CLASS}`).forEach(item => {
        item.classList.remove(HEADING_NUMBER_ACTIVE_CLASS);
    });
};

const isNumberedHeadingTarget = (element: Element) => {
    return !element.closest(".bq, .callout, .protyle-wysiwyg__embed");
};

const measureHeadingNumber = (heading: Element, number: string) => {
    const measureElement = heading.ownerDocument.createElement("span");
    measureElement.classList.add(HEADING_NUMBER_MEASURE_CLASS);
    measureElement.setAttribute("aria-hidden", "true");
    measureElement.textContent = number;
    heading.appendChild(measureElement);
    const width = measureElement.getBoundingClientRect().width;
    measureElement.remove();
    return 0 < width ? `${width}px` : `${Array.from(number).length}ch`;
};

const getHeadingNumberOffset = (heading: Element, number: string) => {
    const key = `${heading.getAttribute("data-subtype") || ""}\u0000${number}`;
    const measurement = headingNumberMeasurements.get(heading);
    if (measurement?.key === key) {
        return measurement.offset;
    }
    const offset = measureHeadingNumber(heading, number);
    headingNumberMeasurements.set(heading, {key, offset});
    return offset;
};

const escapeCSSString = (value: string) => Array.from(value).map(character => {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
        return `\\${code.toString(16)} `;
    }
    if (character === "\\" || character === '"') {
        return `\\${character}`;
    }
    return character;
}).join("");

export const buildHeadingNumberStyles = (scope: string, styles: IHeadingNumberStyle[]) => {
    if (styles.length === 0) {
        return "";
    }
    const scopeSelector = `.protyle-wysiwyg[data-heading-number-scope="${escapeCSSString(scope)}"]`;
    const headingSelector = `${scopeSelector} [data-node-id][data-type="NodeHeading"]`;
    const editableSelector = `${headingSelector}>:first-child[contenteditable]`;
    const rules = [
        `${headingSelector}{--b3-protyle-heading-number:"";--b3-protyle-heading-number-offset:0px;}`,
        `${editableSelector}{position:relative;` +
        "padding-inline-start:var(--b3-protyle-heading-number-offset);}",
        `${editableSelector}::before{content:var(--b3-protyle-heading-number);position:absolute;` +
        "inset-inline-start:0;" +
        "top:0;width:auto;height:auto;background-color:transparent;color:var(--b3-theme-on-surface-light);" +
        "unicode-bidi:isolate;user-select:none;pointer-events:none;}",
    ];
    styles.forEach(style => {
        rules.push(`${scopeSelector} [data-type="NodeHeading"][data-node-id="${escapeCSSString(style.id)}"]{` +
            `--b3-protyle-heading-number:"${escapeCSSString(style.number)}";` +
            `--b3-protyle-heading-number-offset:calc(${style.offset} + .5em);}`);
    });
    return rules.join("");
};

export const renderHeadingNumberElements = (root: Element, numbers: Record<string, string>) => {
    const levels: Record<string, string> = {};
    const containers = new Set<string>();
    const styles: IHeadingNumberStyle[] = [];
    root.querySelectorAll(HEADING_SELECTOR).forEach(item => {
        const id = item.getAttribute("data-node-id");
        const number = id ? numbers[id] : "";
        const editElement = item.querySelector(":scope > :first-child[contenteditable]");
        item.querySelectorAll(`.${HEADING_NUMBER_CLASS}`).forEach(element => element.remove());
        item.classList.remove(HEADING_NUMBER_ACTIVE_CLASS);
        item.removeAttribute("data-heading-number");
        editElement?.removeAttribute("data-heading-number");
        (editElement as HTMLElement)?.style.removeProperty(HEADING_NUMBER_WIDTH_PROPERTY);
        if (id) {
            levels[id] = item.getAttribute("data-subtype") || "";
        }
        if (id && editElement && number && isNumberedHeadingTarget(item)) {
            styles.push({id, number, offset: getHeadingNumberOffset(item, number)});
            let ancestor = item.parentElement;
            while (ancestor && ancestor !== root) {
                const ancestorID = ancestor.getAttribute("data-node-id");
                if (ancestorID) {
                    containers.add(ancestorID);
                }
                ancestor = ancestor.parentElement;
            }
        }
    });
    return {containers, levels, styles};
};

export const cleanHeadingNumberHTML = (html: string) => {
    if (!html?.includes("data-heading-number") &&
        !html?.includes(HEADING_NUMBER_CLASS) &&
        !html?.includes(HEADING_NUMBER_WIDTH_PROPERTY)) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll("[data-heading-number]").forEach(item => {
        item.removeAttribute("data-heading-number");
    });
    template.content.querySelectorAll<HTMLElement>(`[style*="${HEADING_NUMBER_WIDTH_PROPERTY}"]`).forEach(item => {
        item.style.removeProperty(HEADING_NUMBER_WIDTH_PROPERTY);
        if (!item.getAttribute("style")) {
            item.removeAttribute("style");
        }
    });
    template.content.querySelectorAll(`.${HEADING_NUMBER_CLASS}`).forEach(item => item.remove());
    template.content.querySelectorAll(`.${HEADING_NUMBER_ACTIVE_CLASS}`).forEach(item => {
        item.classList.remove(HEADING_NUMBER_ACTIVE_CLASS);
    });
    return template.innerHTML;
};

export const cleanHeadingNumberOperations = (operations?: IOperation[]) => {
    operations?.forEach(operation => {
        if (["appendInsert", "insert", "prependInsert", "update"].includes(operation.action) &&
            typeof operation.data === "string") {
            operation.data = cleanHeadingNumberHTML(operation.data);
        }
        if (operation.action === "unfoldHeading" && typeof operation.retData === "string") {
            operation.retData = cleanHeadingNumberHTML(operation.retData);
        }
    });
};

const operationDataHasHeading = (data: unknown) => {
    if (typeof data !== "string" || !data.includes("NodeHeading")) {
        return false;
    }
    const template = document.createElement("template");
    template.innerHTML = data;
    return Boolean(template.content.querySelector('[data-type="NodeHeading"]'));
};

const operationHeadingLevel = (operation: IOperation) => {
    if (typeof operation.data !== "string" || !operation.data.includes("NodeHeading")) {
        return "";
    }
    const template = document.createElement("template");
    template.innerHTML = operation.data;
    const element = Array.from(template.content.querySelectorAll('[data-type="NodeHeading"]')).find(item => {
        return item.getAttribute("data-node-id") === operation.id;
    });
    return element?.getAttribute("data-subtype") || "";
};

export const operationsMayChangeHeadingNumbers = (
    operations: IOperation[],
    headingNumbers: Record<string, string> = {},
    headingNumberLevels: Record<string, string> = {},
    headingContainers: Set<string> = new Set(),
) => {
    return operations.some(operation => {
        if (["append", "delete", "move", "moveOutlineHeading"].includes(operation.action)) {
            return true;
        }
        if (operation.action === "update") {
            if (operation.id && headingContainers.has(operation.id)) {
                return true;
            }
            const oldLevel = headingNumberLevels[operation.id];
            const newLevel = operationHeadingLevel(operation);
            if (oldLevel || newLevel) {
                return oldLevel !== newLevel;
            }
            if (headingNumbers[operation.id]) {
                return true;
            }
        }
        return ["appendInsert", "insert", "prependInsert", "update"].includes(operation.action) &&
            operationDataHasHeading(operation.data);
    });
};
