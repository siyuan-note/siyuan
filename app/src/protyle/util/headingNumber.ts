import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {isEncryptedBox} from "../../util/pathName";
import {
    clearHeadingNumberElements,
    operationsMayChangeHeadingNumbers,
    renderHeadingNumberElements
} from "./headingNumberCore";

export {cleanHeadingNumberHTML, cleanHeadingNumberOperations} from "./headingNumberCore";

const REFRESH_DELAY = 300;
const refreshTimers = new WeakMap<IProtyle, number>();
const refreshVersions = new WeakMap<IProtyle, number>();
const headingNumberContainers = new WeakMap<IProtyle, Set<string>>();

const clearHeadingNumbers = (protyle: IProtyle) => {
    clearHeadingNumberElements(protyle.wysiwyg.element);
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
        headingNumberContainers.delete(protyle);
        return;
    }

    const numbers = protyle.block.headingNumbers || {};
    const {containers, levels} = renderHeadingNumberElements(protyle.wysiwyg.element, numbers);
    protyle.block.headingNumberLevels = levels;
    headingNumberContainers.set(protyle, containers);
};

export const invalidateHeadingNumberRefresh = (protyle: IProtyle) => {
    window.clearTimeout(refreshTimers.get(protyle));
    refreshTimers.delete(protyle);
    refreshVersions.set(protyle, (refreshVersions.get(protyle) || 0) + 1);
};

export const queueHeadingNumberRefresh = (protyle: IProtyle, operations?: IOperation[]) => {
    if (!window.siyuan.config.editor.headingNumber) {
        invalidateHeadingNumberRefresh(protyle);
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
            headingNumberContainers.get(protyle),
        ))) {
        renderHeadingNumbers(protyle);
        return;
    }

    window.clearTimeout(refreshTimers.get(protyle));
    const rootID = protyle.block.rootID;
    const format = window.siyuan.config.editor.headingNumberFormat;
    const version = (refreshVersions.get(protyle) || 0) + 1;
    refreshVersions.set(protyle, version);
    refreshTimers.set(protyle, window.setTimeout(() => {
        refreshTimers.delete(protyle);
        const request: IObject = {id: rootID};
        if (isEncryptedBox(protyle.notebookId)) {
            request.notebook = protyle.notebookId;
        }
        fetchPost("/api/outline/getDocHeadingNumbers", request, response => {
            if (response.code !== 0 ||
                !window.siyuan.config.editor.headingNumber ||
                window.siyuan.config.editor.headingNumberFormat !== format ||
                !protyle.element.isConnected ||
                protyle.block.rootID !== rootID ||
                refreshVersions.get(protyle) !== version) {
                return;
            }
            renderHeadingNumbers(protyle, response.data || {});
        });
    }, REFRESH_DELAY));
};
