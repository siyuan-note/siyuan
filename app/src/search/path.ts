import {fetchSyncPost} from "../util/fetch";
import {escapeHtml} from "../util/escape";
import {
    getSearchPathID,
    isCurrentSearchPath,
    isSearchPathRequestVersionCurrent,
    isSearchPathAffectedByNotebookRename,
    isSearchPathAffectedByRename,
    nextSearchPathRequestVersion,
    refreshSearchConfigHPath,
    resolveSearchNotebookHPath,
    resolveSearchHPath,
} from "./config";

const refreshVersions = new WeakMap<Element, number>();
const notebookNameOverrides = new WeakMap<Element, Record<string, string>>();

const nextRefreshVersion = (element: Element) => {
    const version = (refreshVersions.get(element) || 0) + 1;
    refreshVersions.set(element, version);
    return version;
};

export const beginSearchPathRequest = (element: Element) => {
    const version = nextSearchPathRequestVersion(element);
    nextRefreshVersion(element);
    return () => isSearchPathRequestVersionCurrent(element, version) && element.isConnected;
};

const resolveCurrentSearchHPath = (idPath: string[], notebookNames: Record<string, string> = {}) => {
    return resolveSearchHPath(idPath, async (path) => {
        const id = getSearchPathID(path);
        const notebookHPath = resolveSearchNotebookHPath(path, window.siyuan.notebooks, notebookNames);
        if (notebookHPath) {
            return notebookHPath;
        }
        const hPathResponse = await fetchSyncPost("/api/filetree/getFullHPathByID", {id});
        if (hPathResponse.code !== 0 || typeof hPathResponse.data !== "string") {
            return;
        }
        const pathResponse = await fetchSyncPost("/api/filetree/getPathByID", {id});
        if (pathResponse.code !== 0 || typeof pathResponse.data?.notebook !== "string" ||
            typeof pathResponse.data?.path !== "string" ||
            !isCurrentSearchPath(path, pathResponse.data.notebook, pathResponse.data.path)) {
            return;
        }
        return hPathResponse.data;
    });
};

const renderSearchPath = (element: Element, hPath: string) => {
    const pathElement = element.querySelector("#searchPathInput");
    if (pathElement) {
        pathElement.innerHTML = `${escapeHtml(hPath)}<svg class="search__rmpath"><use xlink:href="#iconCloseRound"></use></svg>`;
        pathElement.setAttribute("aria-label", hPath);
    }
};

export const refreshCurrentSearchPath = async (options: {
    config: Config.IUILayoutTabSearchConfig,
    element: Element,
    resolveHPath?: (idPath: string[]) => Promise<string | undefined>,
}) => {
    const version = nextRefreshVersion(options.element);
    return refreshSearchConfigHPath({
        config: options.config,
        resolveHPath: options.resolveHPath || ((idPath) => resolveCurrentSearchHPath(
            idPath, notebookNameOverrides.get(options.element))),
        isCurrent: () => refreshVersions.get(options.element) === version && options.element.isConnected,
        render: (hPath) => renderSearchPath(options.element, hPath),
    });
};

export const invalidateSearchPathRequests = (element: Element) => {
    nextSearchPathRequestVersion(element);
    nextRefreshVersion(element);
};

export const refreshSearchPathAfterRename = async (options: {
    config: Config.IUILayoutTabSearchConfig,
    element: Element,
    rename: {
        box: string,
        id?: string,
        path: string,
    },
}) => {
    if (!isSearchPathAffectedByRename(options.config.idPath || [], options.rename.box, options.rename.path,
        options.rename.id)) {
        return;
    }
    return refreshCurrentSearchPath(options);
};

export const refreshSearchPathAfterNotebookRename = async (options: {
    config: Config.IUILayoutTabSearchConfig,
    element: Element,
    notebookId: string,
    notebookName: string,
}) => {
    if (!isSearchPathAffectedByNotebookRename(options.config.idPath || [], options.notebookId)) {
        return;
    }
    const notebookNames = notebookNameOverrides.get(options.element) || {};
    notebookNames[options.notebookId] = options.notebookName;
    notebookNameOverrides.set(options.element, notebookNames);
    return refreshCurrentSearchPath(options);
};
