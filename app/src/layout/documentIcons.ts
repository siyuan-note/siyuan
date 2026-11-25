import {isSensitiveLayoutData} from "../protyle/util/compatibility";
import {fetchSyncPost} from "../util/fetch";
import {withFetchTimeout} from "../util/fetchTimeout";

export const refreshLayoutDocumentIcons = async (layout?: Config.TPersistedUILayoutItem) => {
    const tabsByDocument = new Map<string, Extract<Config.TPersistedUILayoutItem, {instance: "Tab"}>[]>();
    const collectTabs = (item?: Config.TPersistedUILayoutItem) => {
        const children = Array.isArray(item?.children) ? item.children : [item?.children];
        if (item?.instance === "Tab") {
            const editor = children.find(child => child?.instance === "Editor");
            if (editor?.rootId && !isSensitiveLayoutData(editor)) {
                const tabs = tabsByDocument.get(editor.rootId);
                if (tabs) {
                    tabs.push(item);
                } else {
                    tabsByDocument.set(editor.rootId, [item]);
                }
            }
        } else if (item) {
            children.forEach(collectTabs);
        }
    };
    collectTabs(layout);
    if (!tabsByDocument.size) {
        return;
    }

    const ids = [...tabsByDocument.keys()];
    const response = await withFetchTimeout(signal =>
        fetchSyncPost("/api/attr/batchGetBlockAttrs", {ids}, undefined, false, signal), undefined, 3000).catch((): undefined => undefined);
    if (response?.code !== 0 || !response.data) {
        return;
    }
    for (const [id, tabs] of tabsByDocument) {
        const attrs = response.data[id];
        if (attrs) {
            tabs.forEach(tab => tab.docIcon = attrs.icon ?? "");
        }
    }
};
