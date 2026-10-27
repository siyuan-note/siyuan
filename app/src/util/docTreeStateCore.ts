import type {DocTreeController} from "../layout/dock/docTree/DocTreeController";
import type {IDocTreeExpansion} from "../layout/dock/docTree/types";
import {restoreFileTreePaths} from "./fileTreeRestore";

type TStateController = Pick<DocTreeController, "getExpandedItems" | "getScrollAnchor" | "restoreExpanded" |
    "locate" | "findItem" | "restoreScrollAnchor">;

export const collectDocTreeState = (controller: Pick<TStateController, "getExpandedItems" | "getScrollAnchor">): IFilesPath[] => {
    const states = new Map<string, IFilesPath>();
    const stateFor = (notebookId: string) => {
        if (!states.has(notebookId)) {
            states.set(notebookId, {notebookId, openPaths: [], version: 2, expandedIDs: []});
        }
        return states.get(notebookId);
    };
    for (const item of controller.getExpandedItems()) {
        const state = stateFor(item.notebookId);
        if (!state.expandedIDs.some(existing => existing.id === item.id && existing.kind === item.kind)) {
            state.expandedIDs.push({id: item.id, kind: item.kind});
        }
    }
    const anchor = controller.getScrollAnchor();
    if (anchor?.notebookId && anchor.id && Number.isFinite(anchor.offset)) {
        stateFor(anchor.notebookId).scrollAnchor = {id: anchor.id, offset: anchor.offset};
    }
    return Array.from(states.values());
};

export const restoreDocTreeStateData = async (controller: TStateController, states: IFilesPath[],
                                             isCurrent: () => boolean = () => true) => {
    if (!Array.isArray(states)) {
        return;
    }
    const valid = states.filter(state => typeof state?.notebookId === "string");
    const expanded: Pick<IDocTreeExpansion, "notebookId" | "id" | "kind">[] = [];
    for (const state of valid) {
        if (state.version === 2 && Array.isArray(state.expandedIDs)) {
            state.expandedIDs.forEach(item => {
                if (typeof item?.id === "string" && ["document", "notebook"].includes(item.kind)) {
                    expanded.push({notebookId: state.notebookId, id: item.id, kind: item.kind});
                }
            });
        }
    }
    // 旧布局保存的是已展开目录内的子文档路径，只恢复其祖先，避免把叶节点误展开。
    await restoreFileTreePaths(valid.filter(state => state.version !== 2).map(state => ({
        notebookId: state.notebookId,
        openPaths: Array.isArray(state.openPaths) ? state.openPaths.filter(path => typeof path === "string") : [],
    })), async (notebookId, path) => {
        const id = path === "/" ? notebookId : path.slice(path.lastIndexOf("/") + 1).replace(/\.sy$/, "");
        expanded.push({notebookId, id, kind: path === "/" ? "notebook" : "document"});
    });
    for (const item of expanded) {
        if (!isCurrent()) {
            return;
        }
        try {
            await controller.restoreExpanded([item]);
        } catch (error) {
            // 已保存的文档可能已删除或失去访问权限，继续恢复其他可用分支。
            console.error(error);
        }
    }
    if (!isCurrent()) {
        return;
    }
    const anchored = valid.find(state => typeof state.scrollAnchor?.id === "string" &&
        Number.isFinite(state.scrollAnchor.offset));
    if (anchored) {
        try {
            await controller.locate(anchored.notebookId, anchored.scrollAnchor.id, {select: false, scroll: false});
        } catch (error) {
            console.error(error);
            return;
        }
        if (!isCurrent()) {
            return;
        }
        const item = controller.findItem(anchored.notebookId, anchored.scrollAnchor.id);
        if (item) {
            controller.restoreScrollAnchor({notebookId: item.notebookId, id: item.id,
                occurrenceKey: item.occurrenceKey, index: item.index, offset: anchored.scrollAnchor.offset});
        }
    }
};
