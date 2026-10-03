import {ipcRenderer, webFrame} from "electron";
import {Constants} from "../../constants";
import {setNoteBook} from "../../util/pathName";
import {fetchSyncPost} from "../../util/fetch";
import {genNotebookOption} from "../../menus/onGetnotebookconf";
import {isMac} from "../../protyle/util/compatibility";
import {setToolbarLeftMac} from "../../util/functions";
import {ensureLute} from "../../protyle/util/lute";
import {renderSnippet} from "../util/snippets";
import {onAgentStreamingMarkdownStorageChanged} from "../tabs/ai/agentStreamingMarkdown";
import type {ISettingsWindowHost} from "./windowContext";

let notebookRefresh = () => Promise.resolve();
export const refreshSettingsWindowNotebooks = () => notebookRefresh();

// 初始化失败或依赖请求一直未完成时关闭窗口，迟到的回调由生命周期检查拦截。
export const startSettingsWindow = async (initialize: () => Promise<void>, failed: (error: unknown) => void, timeout = 30000) => {
    let timer: ReturnType<typeof setTimeout>;
    try {
        await Promise.race([initialize(), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Settings window initialization timed out")), timeout);
        })]);
    } catch (error) {
        failed(error);
    } finally {
        clearTimeout(timer);
    }
};

// 宿主握手仅接受同步应答，失效令牌不能让隐藏窗口无限等待。
export const resolveSettingsWindowHost = (): ISettingsWindowHost | undefined => {
    const token = new URLSearchParams(location.search).get("settingsWindowToken");
    if (!token) return;
    try {
        if (!window.opener || window.opener.closed || window.opener.location.origin !== location.origin) return;
        let accepting = true;
        let host: ISettingsWindowHost;
        window.opener.dispatchEvent(new CustomEvent("siyuan-settings-host-" + token, {
            detail: (value: ISettingsWindowHost) => {
                if (accepting && !host && value?.isActive()) host = value;
            },
        }));
        accepting = false;
        return host;
    } catch (error) {
        console.warn("Could not connect to the settings window owner", error);
    }
};

// 只更新笔记本选项，保留当前选择、未保存输入和设置搜索过滤状态。
export const patchSettingsNotebookOptions = () => {
    const patch = (select: HTMLSelectElement, render: (selected: string) => void) => {
        const selected = select.value;
        const label = select.selectedOptions[0]?.textContent || selected;
        render(selected);
        if (![...select.options].some(option => option.value === selected)) {
            const unavailable = document.createElement("option");
            unavailable.value = selected;
            unavailable.textContent = label;
            unavailable.disabled = true;
            select.append(unavailable);
        }
        select.value = selected;
    };
    for (const key of ["docCreateSaveBox", "refCreateSaveBox", "shorthandSaveBox"]) {
        const select = document.getElementById("fileTree." + key) as HTMLSelectElement;
        if (!select) continue;
        patch(select, selected => {
            const shorthand = key === "shorthandSaveBox";
            select.innerHTML = genNotebookOption(selected, undefined, shorthand,
                shorthand ? item => !item.closed && !item.encrypted : undefined);
        });
    }
    document.querySelectorAll<HTMLSelectElement>('#historyContainer select[data-type="notebookselect"]').forEach(select => {
        patch(select, () => {
            const options = [{id: "%", name: window.siyuan.languages.allNotebooks},
                ...window.siyuan.notebooks.filter(item => !item.closed)];
            select.replaceChildren(...options.map(item => {
                const option = document.createElement("option");
                option.value = item.id;
                option.textContent = item.name;
                return option;
            }));
        });
    });
};

export const createSettingsWindowRuntime = (isActive: () => boolean) => {
    let notebooksPending = false;
    let notebooksLoading: Promise<void>;
    let snippetRevision = 0;
    let snippetsPending = false;
    let snippetConfigPending = false;
    let snippetsLoading: Promise<void>;
    let zoomRevision = 0;

    const applyZoom = () => {
        if (!isActive()) return;
        const value = window.siyuan.storage[Constants.LOCAL_ZOOM];
        const size = Constants.SIZE_ZOOM.find(item => item.zoom === value) ||
            Constants.SIZE_ZOOM.find(item => item.zoom === 1);
        webFrame.setZoomFactor(size.zoom);
        setToolbarLeftMac(size.zoom);
        if (isMac()) {
            // 设置窗口有自己的标题栏，不使用主窗口隐藏工具栏的偏移。
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd: "setTrafficLightPosition", zoom: size.zoom, position: {...size.position},
            });
        }
    };

    const refreshNotebooks = (): Promise<void> => {
        if (!isActive()) return Promise.resolve();
        notebooksPending = true;
        if (notebooksLoading) return notebooksLoading;
        notebooksLoading = (async () => {
            while (notebooksPending && isActive()) {
                notebooksPending = false;
                let refreshed = false;
                await setNoteBook(() => { refreshed = true; });
                if (!isActive()) return;
                if (!refreshed) throw new Error("Could not refresh settings notebooks");
                patchSettingsNotebookOptions();
            }
        })().finally(() => {
            notebooksLoading = undefined;
            if (notebooksPending && isActive()) return refreshNotebooks();
        });
        return notebooksLoading;
    };
    notebookRefresh = refreshNotebooks;

    const refreshSnippets = (reloadConfig = false): Promise<void> => {
        if (!isActive()) return Promise.resolve();
        snippetsPending = true;
        snippetConfigPending ||= reloadConfig;
        snippetRevision++;
        if (snippetsLoading) return snippetsLoading;
        snippetsLoading = (async () => {
            while (snippetsPending && isActive()) {
                snippetsPending = false;
                const revision = snippetRevision;
                if (snippetConfigPending) {
                    snippetConfigPending = false;
                    const response = await fetchSyncPost("/api/system/getConf", {});
                    if (!isActive()) return;
                    if (revision !== snippetRevision) continue;
                    if (response.code === 0) window.siyuan.config.snippet = response.data.conf.snippet;
                }
                if (!isActive()) return;
                await renderSnippet(Constants.TIMEOUT_SNIPPET_LOAD, () => isActive() && revision === snippetRevision,
                    () => ensureLute({reloadOnFailure: false}));
            }
        })().catch(error => console.error("Could not refresh settings snippets", error)).finally(() => {
            snippetsLoading = undefined;
            if (snippetsPending && isActive()) return refreshSnippets();
        });
        return snippetsLoading;
    };

    const refreshZoom = async () => {
        const revision = ++zoomRevision;
        const response = await fetchSyncPost("/api/storage/getLocalStorage");
        if (!isActive() || revision !== zoomRevision || response.code !== 0) return;
        window.siyuan.storage[Constants.LOCAL_ZOOM] = response.data[Constants.LOCAL_ZOOM] ?? 1;
        applyZoom();
    };

    const onStorageChanged = (keys: string[]) => {
        keys.forEach(onAgentStreamingMarkdownStorageChanged);
        if (keys.includes(Constants.LOCAL_ZOOM)) {
            zoomRevision++;
            applyZoom();
        }
    };

    const handleMessage = (data: IWebSocketData): boolean => {
        if (!isActive()) return true;
        switch (data.cmd) {
            case "createnotebook":
            case "renamenotebook":
            case "mount":
            case "closeBox":
            case "removeBox":
            case "syncMergeResult":
            case "notebookSortChanged":
                void refreshNotebooks().catch(error => console.error("Could not refresh settings notebooks", error));
                return true;
            case "setSnippet":
                window.siyuan.config.snippet = data.data;
                void refreshSnippets();
                return true;
            case "setLocalStorageVal":
                window.siyuan.storage[data.data.key] = data.data.val;
                onStorageChanged([data.data.key]);
                return true;
            case "setLocalStorageVals":
                Object.assign(window.siyuan.storage, data.data.keyVals);
                onStorageChanged(Object.keys(data.data.keyVals));
                return true;
            case "removeLocalStorageVal":
                delete window.siyuan.storage[data.data.key];
                onStorageChanged([data.data.key]);
                return true;
            case "removeLocalStorageVals":
                data.data.keys.forEach((key: string) => delete window.siyuan.storage[key]);
                onStorageChanged(data.data.keys);
                return true;
        }
        return false;
    };

    const reconnect = async () => {
        if (!isActive()) return;
        await Promise.all([refreshNotebooks(), refreshSnippets(true), refreshZoom()]);
    };
    return {applyZoom, refreshNotebooks, refreshSnippets, handleMessage, reconnect};
};
