import {Constants} from "../../../constants";
import {normalizeHTMLAssetIFrameBlockDOM} from "../../../asset/html";
import {fetchSyncPost} from "../../../util/fetch";
import {waitForPendingTransactions} from "../../util/transactionQueue";
import {completeTabsListSource} from "../../wysiwyg/tabsList";
import {isProtyleListItemFragment} from "../../runtimeCapabilities";
import {cleanListMindmapHTML} from "./model";

// 标题转换会改动列表层级，先补齐源块，并在异步读取后复核编辑器和正文。
export const prepareListMindmapConversion = async (owner: IProtyle, list: Element): Promise<Element | undefined> => {
    const rootID = owner.block.rootID;
    const notebookId = owner.notebookId;
    const id = list.getAttribute("data-node-id");
    const type = list.getAttribute("data-type");
    const isCurrent = () => list.isConnected && !!id && !owner.disabled &&
        (!owner.lite || isProtyleListItemFragment(owner)) &&
        owner.block.rootID === rootID && owner.notebookId === notebookId &&
        !owner.options.action.includes(Constants.CB_GET_HISTORY) &&
        !list.closest(".protyle-wysiwyg__embed") &&
        list.closest(".protyle-wysiwyg") === owner.wysiwyg.element &&
        list.getAttribute("data-node-id") === id && list.getAttribute("data-type") === type;
    if (!isCurrent()) {
        return;
    }
    await owner.wysiwyg.flushPendingInput();
    await waitForPendingTransactions(owner);
    if (!isCurrent()) {
        return;
    }
    const before = cleanListMindmapHTML(list.outerHTML);
    const template = list.ownerDocument.createElement("template");
    if (owner.lite) {
        // 列表项片段持有完整的本地正文，尚未提交的内容不能被内核快照替换。
        template.innerHTML = before;
        return template.content.firstElementChild;
    }
    const response = await fetchSyncPost("/api/block/getBlockDOM", {id, notebook: notebookId});
    if (response.code !== 0 || !isCurrent() || cleanListMindmapHTML(list.outerHTML) !== before) {
        return;
    }
    template.innerHTML = normalizeHTMLAssetIFrameBlockDOM(response.data?.dom || "");
    const full = template.content.firstElementChild;
    if (full?.getAttribute("data-node-id") !== id || full.getAttribute("data-type") !== type) {
        return;
    }
    return completeTabsListSource(list, full);
};
