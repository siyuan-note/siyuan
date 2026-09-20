// 发布视图状态仅保留在当前页面内存中，不写入数据库或本地配置。
const views = new Map<string, string>();
const folds = new Map<string, Record<string, boolean>>();

type PublishAVCarrier = Pick<HTMLElement, "dataset">;
const blockKey = (element: PublishAVCarrier) => JSON.stringify([element.dataset.nodeId, element.dataset.avId]);
const groupKey = (element: PublishAVCarrier, viewID: string) => JSON.stringify([blockKey(element), viewID]);

export const getPublishAVView = (element: PublishAVCarrier) => views.get(blockKey(element)) || "";

export const setPublishAVView = (element: PublishAVCarrier, viewID: string) => {
    if (viewID) {
        views.set(blockKey(element), viewID);
    } else {
        views.delete(blockKey(element));
    }
};

export const setPublishAVFolds = (element: PublishAVCarrier, viewID: string, states: Record<string, boolean>) => {
    const key = groupKey(element, viewID);
    folds.set(key, {...folds.get(key), ...states});
};

export const applyPublishAVFolds = (element: PublishAVCarrier, data: IAV) => {
    const states = folds.get(groupKey(element, data.viewID));
    if (!states) {
        return;
    }
    data.view.groups?.forEach(group => {
        if (typeof states[group.id] === "boolean") {
            group.groupFolded = states[group.id];
        }
    });
};
