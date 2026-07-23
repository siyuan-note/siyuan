const HEADING_SELECTOR = '[data-node-id][data-type="NodeHeading"]';
const HEADING_NUMBER_CLASS = "protyle-heading-number";
const HEADING_NUMBER_ACTIVE_CLASS = "protyle-heading-number--active";
const HEADING_NUMBER_MEASURE_CLASS = "protyle-heading-number__measure";
const HEADING_NUMBER_WIDTH_PROPERTY = "--b3-protyle-heading-number-width";
const NUMBERED_HEADING_SELECTOR = `${HEADING_SELECTOR}[data-heading-number], ` +
    `${HEADING_SELECTOR} > [contenteditable][data-heading-number]`;
const HEADING_CONTAINER_TYPES = new Set(["NodeDocument", "NodeList", "NodeListItem", "NodeSuperBlock"]);
let headingNumberMeasurements = new WeakMap<Element, {key: string, offset: string}>();

export interface IHeadingNumberStyle {
    id: string;
    number: string;
    offset: string;
}

interface IHeadingNumberTarget extends IHeadingNumberStyle {
    element: Element;
}

export const invalidateHeadingNumberMeasurements = () => {
    headingNumberMeasurements = new WeakMap<Element, {key: string, offset: string}>();
};

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

const measureHeadingNumbers = (targets: IHeadingNumberTarget[]) => {
    const pending: {
        key: string,
        measureElement: HTMLElement,
        target: IHeadingNumberTarget,
    }[] = [];
    targets.forEach(target => {
        const key = `${target.element.getAttribute("data-subtype") || ""}\u0000${target.number}`;
        const measurement = headingNumberMeasurements.get(target.element);
        if (measurement?.key === key) {
            target.offset = measurement.offset;
            return;
        }
        const measureElement = target.element.ownerDocument.createElement("span");
        measureElement.classList.add(HEADING_NUMBER_MEASURE_CLASS);
        measureElement.setAttribute("aria-hidden", "true");
        measureElement.textContent = target.number;
        target.element.appendChild(measureElement);
        pending.push({key, measureElement, target});
    });
    pending.forEach(item => {
        const width = item.measureElement.getBoundingClientRect().width;
        const offset = 0 < width ? `${width}px` : `${Array.from(item.target.number).length}ch`;
        item.target.offset = offset;
        headingNumberMeasurements.set(item.target.element, {key: item.key, offset});
    });
    pending.forEach(item => item.measureElement.remove());
    return targets.map(target => ({id: target.id, number: target.number, offset: target.offset}));
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
    const targets: IHeadingNumberTarget[] = [];
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
            targets.push({element: item, id, number, offset: ""});
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
    const styles = measureHeadingNumbers(targets);
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

const operationDataIsHeadingContainer = (data: unknown) => {
    if (typeof data !== "string") {
        return false;
    }
    const match = data.match(/^\s*<[^>]*\bdata-type=(["'])([^"']+)\1/);
    return match ? HEADING_CONTAINER_TYPES.has(match[2]) : false;
};

export const operationsMayChangeOutline = (operations: IOperation[] = [], headingIDs: Set<string> = new Set()) => {
    return operations.some(operation => {
        if (["append", "delete", "move", "moveOutlineHeading"].includes(operation.action)) {
            return true;
        }
        if (operation.action === "update" && operation.id && headingIDs.has(operation.id)) {
            return true;
        }
        return ["appendInsert", "insert", "prependInsert", "update"].includes(operation.action) &&
            (operationDataHasHeading(operation.data) ||
                (operation.action === "update" && operationDataIsHeadingContainer(operation.data)));
    });
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
            if (operationDataIsHeadingContainer(operation.data)) {
                return true;
            }
        }
        return ["appendInsert", "insert", "prependInsert", "update"].includes(operation.action) &&
            operationDataHasHeading(operation.data);
    });
};
