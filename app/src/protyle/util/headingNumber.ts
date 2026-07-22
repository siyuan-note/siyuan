import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {isEncryptedBox} from "../../util/pathName";

const HEADING_SELECTOR = '[data-node-id][data-type="NodeHeading"]';
const NUMBERED_HEADING_SELECTOR = `${HEADING_SELECTOR}[data-heading-number]`;
const REFRESH_DELAY = 300;
const refreshTimers = new WeakMap<IProtyle, number>();
const refreshVersions = new WeakMap<IProtyle, number>();

const clearHeadingNumbers = (protyle: IProtyle) => {
    protyle.wysiwyg.element.querySelectorAll(NUMBERED_HEADING_SELECTOR).forEach(item => {
        item.removeAttribute("data-heading-number");
    });
};

const isNumberedHeadingTarget = (element: Element) => {
    return !element.closest(".bq, .callout, .protyle-wysiwyg__embed");
};

export const renderHeadingNumbers = (
    protyle: IProtyle,
    headingNumbers?: Record<string, string> | null,
) => {
    if (typeof headingNumbers !== "undefined") {
        protyle.block.headingNumbers = headingNumbers || {};
    }
    if (protyle.options.backlinkData ||
        protyle.block.action?.includes(Constants.CB_GET_HISTORY)) {
        clearHeadingNumbers(protyle);
        return;
    }

    const numbers = protyle.block.headingNumbers || {};
    const levels: Record<string, string> = {};
    protyle.wysiwyg.element.querySelectorAll(HEADING_SELECTOR).forEach(item => {
        const id = item.getAttribute("data-node-id");
        const number = id ? numbers[id] : "";
        if (id) {
            levels[id] = item.getAttribute("data-subtype") || "";
        }
        if (number && isNumberedHeadingTarget(item)) {
            item.setAttribute("data-heading-number", number);
        } else {
            item.removeAttribute("data-heading-number");
        }
    });
    protyle.block.headingNumberLevels = levels;
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
) => {
    return operations.some(operation => {
        if (["append", "delete", "move", "moveOutlineHeading"].includes(operation.action)) {
            return true;
        }
        if (operation.action === "update") {
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

export const queueHeadingNumberRefresh = (protyle: IProtyle, operations?: IOperation[]) => {
    if (!window.siyuan.config.editor.headingNumber) {
        renderHeadingNumbers(protyle, {});
        return;
    }
    if (protyle.options.backlinkData ||
        protyle.block.action?.includes(Constants.CB_GET_HISTORY) ||
        !protyle.block.rootID ||
        (operations && !operationsMayChangeHeadingNumbers(
            operations,
            protyle.block.headingNumbers,
            protyle.block.headingNumberLevels,
        ))) {
        renderHeadingNumbers(protyle);
        return;
    }

    window.clearTimeout(refreshTimers.get(protyle));
    const rootID = protyle.block.rootID;
    const version = (refreshVersions.get(protyle) || 0) + 1;
    refreshVersions.set(protyle, version);
    refreshTimers.set(protyle, window.setTimeout(() => {
        const request: IObject = {id: rootID};
        if (isEncryptedBox(protyle.notebookId)) {
            request.notebook = protyle.notebookId;
        }
        fetchPost("/api/outline/getDocHeadingNumbers", request, response => {
            if (response.code !== 0 ||
                !protyle.element.isConnected ||
                protyle.block.rootID !== rootID ||
                refreshVersions.get(protyle) !== version) {
                return;
            }
            renderHeadingNumbers(protyle, response.data || {});
        });
    }, REFRESH_DELAY));
};
