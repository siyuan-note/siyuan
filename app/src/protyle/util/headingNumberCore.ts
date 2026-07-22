const HEADING_SELECTOR = '[data-node-id][data-type="NodeHeading"]';
const NUMBERED_HEADING_SELECTOR = `${HEADING_SELECTOR}[data-heading-number], ` +
    `${HEADING_SELECTOR} > [contenteditable][data-heading-number]`;

export const clearHeadingNumberElements = (root: Element) => {
    root.querySelectorAll(NUMBERED_HEADING_SELECTOR).forEach(item => {
        item.removeAttribute("data-heading-number");
    });
};

const isNumberedHeadingTarget = (element: Element) => {
    return !element.closest(".bq, .callout, .protyle-wysiwyg__embed");
};

export const renderHeadingNumberElements = (root: Element, numbers: Record<string, string>) => {
    const levels: Record<string, string> = {};
    const containers = new Set<string>();
    root.querySelectorAll(HEADING_SELECTOR).forEach(item => {
        const id = item.getAttribute("data-node-id");
        const number = id ? numbers[id] : "";
        const editElement = item.querySelector(":scope > [contenteditable]");
        item.removeAttribute("data-heading-number");
        if (id) {
            levels[id] = item.getAttribute("data-subtype") || "";
        }
        if (editElement && number && isNumberedHeadingTarget(item)) {
            editElement.setAttribute("data-heading-number", number);
            let ancestor = item.parentElement;
            while (ancestor && ancestor !== root) {
                const ancestorID = ancestor.getAttribute("data-node-id");
                if (ancestorID) {
                    containers.add(ancestorID);
                }
                ancestor = ancestor.parentElement;
            }
        } else {
            editElement?.removeAttribute("data-heading-number");
        }
    });
    return {containers, levels};
};

export const cleanHeadingNumberHTML = (html: string) => {
    if (!html?.includes("data-heading-number")) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll("[data-heading-number]").forEach(item => {
        item.removeAttribute("data-heading-number");
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
