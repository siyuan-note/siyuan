import type {TagRemovalChangeInput, TagRemovalCollection} from "../../types/api";
import {confirmDialog} from "../../dialog/confirmDialog";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {fetchSyncPost} from "../../util/fetch";
import {getSemanticInlineVisibleText} from "./inlineElementMarker";

const operationTags = (operations: IOperation[]) => {
    const result = new Map<string, Set<string>>();
    operations?.forEach(operation => {
        if (operation.action === "setAttrs" && typeof operation.data === "string") {
            const attrs = JSON.parse(operation.data);
            if (typeof attrs.tags === "string") {
                result.set(operation.id, new Set(attrs.tags.split(",").filter(Boolean)));
            }
        } else if (["update", "insert", "appendInsert", "prependInsert"].includes(operation.action) &&
            typeof operation.data === "string") {
            const template = document.createElement("template");
            template.innerHTML = operation.data;
            template.content.querySelectorAll("[data-node-id]").forEach(block => {
                const tags = new Set<string>();
                block.querySelectorAll('[data-type~="tag"]').forEach(tag => {
                    if (tag.closest("[data-node-id]") === block) {
                        tags.add(getSemanticInlineVisibleText(tag).trim());
                    }
                });
                result.set(block.getAttribute("data-node-id"), tags);
            });
        }
    });
    return result;
};

export const getTagRemovalChanges = (operations: IOperation[], undo: IOperation[]): TagRemovalChangeInput[] => {
    if (!undo?.some(operation => (operation.action === "update" || operation.action === "setAttrs") &&
        typeof operation.data === "string" && operation.data.includes("tag"))) {
        return [];
    }
    const before = operationTags(undo);
    const after = operationTags(operations);
    const changes: TagRemovalChangeInput[] = [];
    before.forEach((tags, id) => {
        const next = after.get(id);
        // 整块删除由已有块删除流程处理；同一块内新增标签视为编辑标签名称。
        if (!next || Array.from(next).some(tag => !tags.has(tag))) {
            return;
        }
        const removed = Array.from(tags).filter(tag => !next.has(tag));
        if (removed.length) {
            changes.push({id, tags: removed});
        }
    });
    return changes;
};

export const confirmTagRemoval = (groups: TagRemovalCollection[], text?: string): Promise<TagRemovalCollection[] | null> => {
    if (!groups.length && !text) {
        return Promise.resolve([]);
    }
    return new Promise(resolve => {
        const lang = window.siyuan.languages;
        const content = (text ? `<div>${text}</div>` : "") + (groups.length ?
            `<div class="ft__breakword">${escapeHtml(lang.tagRemovalDatabaseTip)}</div>` + groups.map(group =>
                `<label class="fn__flex b3-label" style="align-items:center"><input type="checkbox" checked class="fn__flex-shrink" data-tag-removal-av="${escapeAttr(group.avID)}"><span class="fn__space"></span><span class="ft__breakword">${escapeHtml(group.name || group.avID)} (${group.cleanup.items.length})</span></label>`).join("") : "");
        const dialog = confirmDialog(lang.deleteOpConfirm, content, () => {
            const selected = new Set(Array.from(dialog.element.querySelectorAll<HTMLInputElement>("[data-tag-removal-av]:checked"))
                .map(input => input.dataset.tagRemovalAv));
            resolve(groups.filter(group => selected.has(group.avID)));
        }, () => resolve(null), true,
        groups.length ? {label: lang.tagRemovalOnly, callback: () => resolve([])} : undefined,
        groups.length ? lang.tagRemovalWithEntries : lang.tagRemovalOnly);
    });
};

export const previewTagRemoval = async (changes: TagRemovalChangeInput[]) => {
    const response = await fetchSyncPost("/api/tag/previewTagRemoval", {changes}, undefined, false);
    if (response.code !== 0) {
        throw new Error(response.msg);
    }
    return confirmTagRemoval(response.data);
};

export const tagRemovalOperations = (groups: TagRemovalCollection[]): IOperation[] => groups.flatMap(group => {
    const operations: IOperation[] = [];
    for (let offset = 0; offset < group.cleanup.items.length; offset += 100) {
        operations.push({action: "cleanupAttrViewBlocks", avID: group.avID,
            data: {...group.cleanup, automaticOnly: true, items: group.cleanup.items.slice(offset, offset + 100)}});
    }
    return operations;
});
