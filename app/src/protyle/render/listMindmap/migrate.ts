import {Constants} from "../../../constants";
import {fetchSyncPost} from "../../../util/fetch";
import {waitForPendingTransactions} from "../../util/transactionQueue";

interface Migration {
    rootID: string;
    pending: boolean;
    resume: (blocks: {id: string, dom: string}[]) => void;
}

const migrations = new WeakMap<IProtyle, Migration>();

export const cancelLegacyMindmapMigration = (protyle: IProtyle) => {
    migrations.delete(protyle);
};

export const replaceLegacyMindmapHTML = (html: string, blocks: {id: string, dom: string}[]) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const replacements = new Map(blocks.map(block => [block.id, block.dom]));
    template.content.querySelectorAll<HTMLElement>('[data-type="NodeCodeBlock"]')
        .forEach(block => {
            if (block.closest('[data-type="NodeBlockQueryEmbed"]')) {
                return;
            }
            const replacement = replacements.get(block.dataset.nodeId);
            if (replacement) {
                block.outerHTML = replacement;
            }
        });
    return template.innerHTML;
};

// 每个编辑器的当前文档只迁移一次，撤销和分页加载不会再次触发；只读内容仅使用派生预览。
export const migrateLegacyMindmapsBeforeRender = (protyle: IProtyle, html: string, actions: string[],
                                                 resume: (html: string) => void) => {
    const rootID = protyle.block.rootID;
    if (!rootID || protyle.lite || protyle.disabled || protyle.options.backlinkData || protyle.options.history ||
        protyle.options.mode === "preview" || window.siyuan.config.readonly || window.siyuan.config.editor.readOnly ||
        protyle.wysiwyg.element.getAttribute(Constants.CUSTOM_SY_READONLY) === "true" ||
        actions.some(action => [Constants.CB_GET_HISTORY, Constants.CB_GET_BACKLINK,
            Constants.CB_GET_APPEND, Constants.CB_GET_BEFORE].includes(action))) {
        return false;
    }
    const previous = migrations.get(protyle);
    const callback = (blocks: {id: string, dom: string}[]) => resume(replaceLegacyMindmapHTML(html, blocks));
    if (previous?.rootID === rootID) {
        if (previous.pending) {
            previous.resume = callback;
        }
        return previous.pending;
    }
    const migration: Migration = {rootID, pending: true, resume: callback};
    migrations.set(protyle, migration);
    const run = async () => {
        let blocks: {id: string, dom: string}[] = [];
        try {
            protyle.wysiwyg.flushPendingInput();
            await waitForPendingTransactions(protyle);
            if (protyle.block.rootID !== rootID || migrations.get(protyle) !== migration) {
                return;
            }
            const response = await fetchSyncPost("/api/block/migrateLegacyMindmaps", {id: rootID, notebook: protyle.notebookId});
            if (response.code === 0) {
                blocks = response.data.blocks;
            }
        } catch (error) {
            console.error(error);
        } finally {
            migration.pending = false;
            if (protyle.block.rootID === rootID && migrations.get(protyle) === migration) {
                migration.resume(blocks);
            }
        }
    };
    void run();
    return true;
};
