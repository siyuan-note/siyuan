import {mobileConfirmDialog} from "../../dialog/mobileConfirmDialog";
import type {TagRemovalChangeInput, TagRemovalCollection} from "../../types/api";
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

export const hasReferenceRemoval = (operations: IOperation[], undo: IOperation[]) => {
    if (!undo?.some(operation => ["update", "insert", "appendInsert", "prependInsert"].includes(operation.action) &&
        typeof operation.data === "string" && operation.data.includes("block-ref"))) {
        return false;
    }
    const references = (items: IOperation[]) => {
        const result = new Map<string, Set<string>>();
        items?.forEach(operation => {
            if (operation.action === "delete") {
                result.delete(operation.id);
            } else if (["update", "insert", "appendInsert", "prependInsert"].includes(operation.action) &&
                typeof operation.data === "string") {
                const template = document.createElement("template");
                template.innerHTML = operation.data;
                template.content.querySelectorAll("[data-node-id]").forEach(block => {
                    const targets = new Set<string>();
                    block.querySelectorAll('[data-type~="block-ref"][data-id]').forEach(reference => {
                        if (reference.closest("[data-node-id]") === block && reference.getAttribute("data-id")) {
                            targets.add(reference.getAttribute("data-id"));
                        }
                    });
                    result.set(block.getAttribute("data-node-id"), targets);
                });
            }
        });
        return result;
    };
    const before = references(undo);
    const after = references(operations);
    // 缺少后续块内容表示整块删除，保留已有块删除确认；锚文本变化不影响来源。
    return Array.from(before).some(([id, targets]) => after.has(id) &&
        Array.from(targets).some(target => !after.get(id).has(target)));
};

export const confirmCollectionRemoval = (groups: TagRemovalCollection[], text?: string,
                                         onlyLabel = window.siyuan.languages.tagRemovalOnly): Promise<TagRemovalCollection[] | null> => {
    if (!groups.length && !text) {
        return Promise.resolve([]);
    }
    return new Promise(resolve => {
        const lang = window.siyuan.languages;
        const content = (text ? `<div>${text}</div>` : "") + (groups.length ?
            `<div class="ft__breakword">${escapeHtml(lang.tagRemovalDatabaseTip)}</div>` + groups.map(group =>
                `<label class="fn__flex b3-label" style="align-items:center"><input type="checkbox" checked class="fn__flex-shrink" data-tag-removal-av="${escapeAttr(group.avID)}"><span class="fn__space"></span><span class="ft__breakword">${escapeHtml(group.name || group.avID)} (${group.cleanup.items.length})</span></label>`).join("") : "");
        const dialog = mobileConfirmDialog(lang.deleteOpConfirm, content, () => {
            const selected = new Set(Array.from(dialog.element.querySelectorAll<HTMLInputElement>("[data-tag-removal-av]:checked"))
                .map(input => input.dataset.tagRemovalAv));
            resolve(groups.filter(group => selected.has(group.avID)));
        }, () => resolve(null), true,
        groups.length ? {label: onlyLabel, callback: () => resolve([])} : undefined,
        groups.length ? lang.tagRemovalWithEntries : onlyLabel);
    });
};

export const previewCollectionRemoval = async (operations: IOperation[], tagChanges: TagRemovalChangeInput[],
                                               referencesRemoved: boolean, isCurrent = () => true) => {
    const response = await fetchSyncPost("/api/av/previewCollectionRemoval", {operations, tagChanges}, undefined, false);
    if (!isCurrent()) {
        return null;
    }
    if (response.code !== 0) {
        throw new Error(response.msg);
    }
    const lang = window.siyuan.languages;
    const collections = await confirmCollectionRemoval(response.data.collections, undefined, referencesRemoved ?
        (tagChanges.length ? lang.sourceRemovalOnly : lang.referenceRemovalOnly) : lang.tagRemovalOnly);
    return collections === null ? null : {collections, sourceVersions: response.data.sourceVersions};
};

export const collectionRemovalOperations = (groups: TagRemovalCollection[]): IOperation[] => groups.flatMap(group => {
    const operations: IOperation[] = [];
    for (let offset = 0; offset < group.cleanup.items.length; offset += 100) {
        operations.push({action: "cleanupAttrViewBlocks", avID: group.avID,
            data: {...group.cleanup, automaticOnly: true, items: group.cleanup.items.slice(offset, offset + 100)}});
    }
    return operations;
});
