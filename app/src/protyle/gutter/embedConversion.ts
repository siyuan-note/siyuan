import {Constants} from "../../constants";
import {showMessage} from "../../dialog/message";
import {escapeHtmlTextAndAttr} from "../../util/escape";
import {fetchSyncPost} from "../../util/fetch";
import {normalizeHTMLAssetIFrameBlockDOM} from "../../asset/html";
import {clearBlockElement} from "../util/clear";
import {remapTabsDOMIDs, wrapPastedTabItems} from "../util/tabsCopy";
import {remapListMindmapIDs} from "../render/listMindmap/model";
import {waitForPendingTransactions} from "../util/transactionQueue";
import {getEmbedGutterOperationContext} from "../wysiwyg/getBlock";
import {transaction} from "../wysiwyg/transaction";
import {focusBlock} from "../util/selection";
import {processRender} from "../util/processCode";
import {highlightRender} from "../render/highlightRender";
import {blockRender} from "../render/blockRender";
import {avRender} from "../render/av/render";
import {removeFoldHeading} from "../util/heading";
import {disposeCustomBlocksInElement} from "../../plugin/customBlockRender";
import {reloadProtyle} from "../util/reload";

const pendingConversions = new WeakSet<Element>();

const resultIDs = (embed: Element) => Array.from(embed.querySelectorAll<HTMLElement>(
    ":scope > .protyle-wysiwyg__embed[data-id]"))
    .map(result => result.dataset.id).filter(id => /^\d{14}-[a-z0-9]{7}$/.test(id));

const canConvert = (protyle: IProtyle, embed: Element) => {
    const context = getEmbedGutterOperationContext(embed);
    return !protyle.disabled && !protyle.lite && embed.isConnected &&
        protyle.wysiwyg.element.contains(embed) && embed.getAttribute("data-type") === "NodeBlockQueryEmbed" &&
        (!context && !embed.closest(".protyle-wysiwyg__embed") || context?.allowChildOperation && context.targetElement !== embed);
};

// 每个查询结果单独分配 ID，重叠结果也可保留各自完整的副本。
const copyResult = (html: string, protyle: IProtyle) => {
    const container = document.createElement("div");
    container.innerHTML = normalizeHTMLAssetIFrameBlockDOM(html);
    wrapPastedTabItems(container, protyle.lute);
    const ids = new Map<string, string>();
    container.querySelectorAll("[data-node-id]").forEach(block => {
        const id = Lute.NewNodeID();
        ids.set(block.getAttribute("data-node-id"), id);
        block.setAttribute("data-node-id", id);
        block.setAttribute("updated", id.split("-")[0]);
        block.removeAttribute("parent-heading");
        clearBlockElement(block);
    });
    remapTabsDOMIDs(container, ids);
    remapListMindmapIDs(container, ids);
    return protyle.lute.SpinBlockDOM(container.innerHTML);
};

export const convertEmbed = async (protyle: IProtyle, embed: Element, references: boolean) => {
    if (!canConvert(protyle, embed) || pendingConversions.has(embed)) {
        return;
    }
    const ids = resultIDs(embed);
    if (ids.length === 0) {
        return;
    }
    const rootID = protyle.block.rootID;
    const notebook = protyle.notebookId;
    const id = embed.getAttribute("data-node-id");
    const oldHTML = protyle.lute.SpinBlockDOM(embed.outerHTML);
    const mode = embed.getAttribute("custom-heading-mode");
    const headingMode = ["0", "1", "2"].includes(mode) ? Number(mode) : window.siyuan.config.editor.headingEmbedMode;
    const unchanged = () => canConvert(protyle, embed) && rootID === protyle.block.rootID &&
        notebook === protyle.notebookId && oldHTML === protyle.lute.SpinBlockDOM(embed.outerHTML) &&
        ids.join() === resultIDs(embed).join();
    pendingConversions.add(embed);
    try {
        await waitForPendingTransactions(protyle);
        if (!unchanged()) {
            return;
        }
        const copies: string[] = [];
        for (const sourceID of ids) {
            const response = await fetchSyncPost("/api/block/getBlockDOM", {id: sourceID, notebook});
            if (response.code !== 0) {
                return;
            }
            if (!response.data.dom) {
                showMessage(window.siyuan.languages.refExpired);
                return;
            }
            if (references) {
                const ref = await fetchSyncPost("/api/block/getRefText", {id: sourceID, notebook});
                if (ref.code !== 0) {
                    return;
                }
                const paragraph = document.createElement("div");
                paragraph.innerHTML = protyle.lute.Md2BlockDOM(sourceID);
                paragraph.querySelector('[contenteditable="true"]').innerHTML =
                    `<span data-type="block-ref" data-id="${sourceID}" data-subtype="d">${escapeHtmlTextAndAttr(Lute.UnEscapeHTMLStr(ref.data || sourceID))}</span>`;
                copies.push(paragraph.innerHTML);
                continue;
            }
            const source = document.createElement("template");
            source.innerHTML = response.data.dom;
            if (source.content.firstElementChild?.getAttribute("data-type") === "NodeHeading" &&
                source.content.firstElementChild.getAttribute("data-node-id") === sourceID && headingMode !== 1) {
                // 标题下的折叠内容不在嵌入渲染 DOM 中，读取完整标题范围后再复制。
                const children = await fetchSyncPost("/api/block/getHeadingChildrenDOM", {
                    id: sourceID, removeFoldAttr: false,
                });
                if (children.code !== 0) {
                    return;
                }
                if (!children.data) {
                    showMessage(window.siyuan.languages.refExpired);
                    return;
                }
                source.innerHTML = children.data;
                if (headingMode === 2) {
                    source.content.firstElementChild.remove();
                }
            }
            copies.push(copyResult(source.innerHTML, protyle));
        }
        if (!unchanged()) {
            return;
        }
        const template = document.createElement("template");
        template.innerHTML = protyle.lute.SpinBlockDOM(copies.join(""));
        const blocks = Array.from(template.content.children);
        if (blocks.length === 0) {
            return;
        }
        // 首块沿用嵌入块 ID，已有指向该嵌入块的引用仍可定位转换后的内容。
        const firstID = blocks[0].getAttribute("data-node-id");
        blocks[0].setAttribute("data-node-id", id);
        const firstIDs = new Map([[firstID, id]]);
        blocks.forEach(block => {
            remapTabsDOMIDs(block, firstIDs);
            remapListMindmapIDs(block, firstIDs);
        });
        const embedAttributes = ["custom-heading-mode", "custom-heading-level", Constants.CUSTOM_SY_EMBED_BREADCRUMB_PARENT_PATH];
        embed.getAttributeNames().forEach(attribute => {
            if (["name", "alias", "memo", "bookmark", "style"].includes(attribute) ||
                attribute.startsWith("custom-") && !embedAttributes.includes(attribute)) {
                blocks[0].setAttribute(attribute, embed.getAttribute(attribute));
            }
        });
        const doOperations: IOperation[] = [];
        const undoOperations: IOperation[] = [];
        // 在仍为嵌入块的锚点后倒序插入，避免折叠标题的插入规则越过原有后续内容。
        blocks.slice(1).reverse().forEach(block => {
            const blockID = block.getAttribute("data-node-id");
            doOperations.push({action: "insert", id: blockID, data: block.outerHTML, previousID: id});
            undoOperations.push({action: "delete", id: blockID});
        });
        doOperations.push({action: "update", id, data: blocks[0].outerHTML});
        undoOperations.push({action: "update", id, data: oldHTML});
        const reloadFoldedContent = !!template.content.querySelector('[data-type="NodeHeading"][fold="1"]');
        if (reloadFoldedContent) {
            // 折叠范围会延伸至原有后续块，转换及历史回放均从内核读取完整的可见范围。
            doOperations[doOperations.length - 1].context = {headingBatchRootID: rootID, ignoreProcess: "true"};
            undoOperations[undoOperations.length - 1].context = {headingBatchRootID: rootID, ignoreProcess: "true"};
        }
        // 事务保存完整子块，本地仅挂载展开部分，避免折叠标题的隐藏内容进入当前编辑区域。
        Array.from(template.content.querySelectorAll('[data-type="NodeHeading"][fold="1"]'))
            .reverse().forEach(removeFoldHeading);
        doOperations.forEach(operation => {
            if (operation.action === "insert" && !template.content.querySelector(`[data-node-id="${operation.id}"]`)) {
                operation.context = {ignoreProcess: "true"};
            }
        });
        disposeCustomBlocksInElement(embed);
        embed.replaceWith(...Array.from(template.content.children));
        blocks[0].setAttribute(Constants.ATTRIBUTE_EDITING, "true");
        transaction(protyle, doOperations, undoOperations, {callback: () => {
            if (rootID !== protyle.block.rootID || notebook !== protyle.notebookId) {
                return;
            }
            if (reloadFoldedContent) {
                reloadProtyle(protyle, false);
                return;
            }
            const first = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
            if (first?.isConnected && first.getClientRects().length > 0) {
                processRender(protyle.wysiwyg.element);
                highlightRender(protyle.wysiwyg.element);
                blockRender(protyle, protyle.wysiwyg.element);
                avRender(protyle.wysiwyg.element, protyle);
                focusBlock(first);
            }
        }});
    } catch (error) {
        showMessage(String(error), 7000, "error");
    } finally {
        pendingConversions.delete(embed);
    }
};

export const embedConversionMenu = (protyle: IProtyle, embed: Element): IMenu[] => {
    const disabled = !canConvert(protyle, embed) || resultIDs(embed).length === 0;
    return [{id: "separator_conversion", type: "separator"}, {
        id: "convertToBlocks", icon: "iconParagraph", label: window.siyuan.languages.embedToBlocks, disabled,
        click: () => { void convertEmbed(protyle, embed, false); },
    }, {
        id: "convertToReferences", icon: "iconRef", label: window.siyuan.languages.embedToReferences, disabled,
        click: () => { void convertEmbed(protyle, embed, true); },
    }];
};
