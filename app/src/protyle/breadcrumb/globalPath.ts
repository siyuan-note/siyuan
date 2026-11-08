import type {DocumentPath} from "../../types/api";
import {escapeHtml} from "../../util/escape";
import {fetchSyncPost} from "../../util/fetch";

export interface GlobalBreadcrumb extends IBreadcrumb {
    globalType?: "notebook" | "document";
    icon?: string;
}

export const isBreadcrumbNotebookAvailable = (notebook: string) => {
    const box = window.siyuan.notebooks.find(item => item.id === notebook);
    return !!box && !box.closed && (!box.encrypted || (box.unlocked && (!box.state || box.state === "Unlocked")));
};

export const mergeGlobalBreadcrumb = (blocks: IBreadcrumb[], document: DocumentPath, notebookName: string,
                                      untitled: string, notebookIcon = "", icons: Record<string, string> = {}): GlobalBreadcrumb[] => {
    const rootIndex = blocks.findIndex(item => item.id === document.id);
    if (rootIndex < 0) return blocks;
    const result: GlobalBreadcrumb[] = [];
    if (document.id !== document.notebook) {
        result.push({id: document.notebook, name: escapeHtml(notebookName), type: "NodeNotebook", subType: "",
            children: [], globalType: "notebook", icon: notebookIcon});
    }
    for (const segment of document.segments || []) {
        if (segment.id === document.id || segment.id === document.notebook) continue;
        result.push({id: segment.id, name: escapeHtml(segment.empty ? untitled : segment.text),
            type: "NodeDocument", subType: "", children: [], globalType: "document", icon: icons[segment.id]});
    }
    const root = blocks[rootIndex];
    const title = document.id === document.notebook ? notebookName :
        document.title.empty ? untitled : document.title.text;
    result.push({...root, name: escapeHtml(title), icon: document.id === document.notebook ? notebookIcon : icons[document.id]},
        ...blocks.slice(rootIndex + 1));
    return result;
};

export const getGlobalBreadcrumb = async (blocks: IBreadcrumb[], notebook: string, rootID: string,
                                         enabled: boolean): Promise<GlobalBreadcrumb[]> => {
    if (!enabled || !notebook || !rootID || blocks.length === 0) return blocks;
    if (!isBreadcrumbNotebookAvailable(notebook)) return [];
    try {
        const response = await fetchSyncPost("/api/filetree/getDocPaths", {notebook, ids: [rootID], includeIcons: true});
        if (!isBreadcrumbNotebookAvailable(notebook)) return [];
        if (response.code !== 0 || !response.data?.documents) return blocks;
        const document = response.data.documents.find(item => item.id === rootID && item.notebook === notebook);
        const box = window.siyuan.notebooks.find(item => item.id === notebook && !item.closed);
        if (!document || !box || (box.encrypted && !box.unlocked)) return blocks;
        return mergeGlobalBreadcrumb(blocks, document, box.name, window.siyuan.languages._kernel[16], box.icon, response.data.icons);
    } catch (error) {
        console.warn("get global breadcrumb failed", error);
        return blocks;
    }
};
