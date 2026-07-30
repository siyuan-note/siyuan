import {Constants} from "../../constants";
import type {App} from "../../index";
import {saveScroll} from "../../protyle/scroll/saveScroll";
import {setStorageVal} from "../../protyle/util/compatibility";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {fetchPost} from "../../util/fetch";
import {genUUID} from "../../util/genID";
import {newFile} from "../../util/newFile";
import {loadMobileFileById, updateRecentDocSwitchTime} from "../editor";
import {openModel} from "../menu/model";
import {closeModel} from "../util/closePanel";
import {setEmpty} from "../util/setEmpty";

const MAX_HISTORY = 32;

export type MobileTabEntry = {
    id: string;
    rootID: string;
    notebookID: string;
    path: string;
    title: string;
    action: TProtyleAction[];
    scroll?: IScrollAttr;
};

type MobileTab = {
    id: string;
    current?: MobileTabEntry;
    backStack: MobileTabEntry[];
    forwardStack: MobileTabEntry[];
    activeAt: number;
};

type MobileTabsState = {
    version: 1;
    activeTabID?: string;
    tabs: MobileTab[];
};

type OpenOptions = {
    action?: TProtyleAction[];
    scrollPosition?: ScrollLogicalPosition;
    notebookId?: string;
    afterOpen?: (protyle: IProtyle) => void;
    forceReload?: boolean;
    newTab?: boolean;
    replace?: boolean;
    scroll?: IScrollAttr;
    tabID?: string;
    recentPreviousRootID?: string;
};

type MobileTabOpenResult = "success" | "cancelled" | "invalid" | "failed";

class InvalidMobileTabTargetError extends Error {
}

const isEntry = (value: unknown): value is MobileTabEntry => {
    const entry = value as MobileTabEntry;
    return !!entry && typeof entry.id === "string" && typeof entry.rootID === "string" &&
        typeof entry.notebookID === "string" && typeof entry.path === "string" &&
        typeof entry.title === "string" && Array.isArray(entry.action);
};

const normalizeTab = (value: unknown): MobileTab | undefined => {
    const tab = value as MobileTab;
    if (!tab || typeof tab.id !== "string") {
        return;
    }
    return {
        id: tab.id,
        current: isEntry(tab.current) ? tab.current : undefined,
        backStack: Array.isArray(tab.backStack) ? tab.backStack.filter(isEntry).slice(-MAX_HISTORY) : [],
        forwardStack: Array.isArray(tab.forwardStack) ? tab.forwardStack.filter(isEntry).slice(-MAX_HISTORY) : [],
        activeAt: typeof tab.activeAt === "number" ? tab.activeAt : 0,
    };
};

export class MobileTabs {
    private state: MobileTabsState;
    private navigationEpoch = 0;
    private abortController?: AbortController;

    constructor(private readonly app: App) {
        const stored = window.siyuan.storage[Constants.LOCAL_MOBILE_TABS] as MobileTabsState | undefined;
        const tabs = stored?.version === 1 && Array.isArray(stored.tabs) ?
            stored.tabs.map(normalizeTab).filter((item): item is MobileTab => !!item) : [];
        this.state = {
            version: 1,
            activeTabID: tabs.some((item) => item.id === stored?.activeTabID) ? stored.activeTabID : tabs[0]?.id,
            tabs,
        };
        this.trimTabs();
        this.persist();
        this.updateCounter();
    }

    private get maxTabs() {
        return Math.max(1, Math.min(32, window.siyuan.config.fileTree.maxOpenTabCount || 8));
    }

    private get activeTab() {
        return this.state.tabs.find((item) => item.id === this.state.activeTabID);
    }

    private cancelNavigation() {
        this.abortController?.abort();
        this.navigationEpoch++;
    }

    private persist() {
        window.siyuan.storage[Constants.LOCAL_MOBILE_TABS] = this.state;
        setStorageVal(Constants.LOCAL_MOBILE_TABS, this.state);
    }

    private updateCounter() {
        const countElement = document.querySelector("#toolbarTabs .toolbar__tabs-count");
        if (countElement) {
            countElement.textContent = this.state.tabs.length.toString();
        }
    }

    private snapshot(tab = this.activeTab) {
        if (!tab?.current || !window.siyuan.mobile.editor?.protyle) {
            return;
        }
        const protyle = window.siyuan.mobile.editor.protyle;
        if (protyle.block.rootID === tab.current.rootID) {
            tab.current.scroll = saveScroll(protyle, true) as IScrollAttr | undefined;
            tab.current.title = (document.getElementById("toolbarName") as HTMLInputElement)?.value || tab.current.title;
            tab.current.id = protyle.block.showAll ? protyle.block.id : protyle.block.rootID;
            tab.current.notebookID = protyle.notebookId;
            tab.current.path = protyle.path;
            tab.current.action = protyle.block.action;
        }
    }

    private entryFromProtyle(id: string, action: TProtyleAction[], protyle: IProtyle): MobileTabEntry {
        return {
            id,
            rootID: protyle.block.rootID,
            notebookID: protyle.notebookId,
            path: protyle.path,
            title: (document.getElementById("toolbarName") as HTMLInputElement)?.value || window.siyuan.languages.untitled,
            action,
            scroll: saveScroll(protyle, true) as IScrollAttr | undefined,
        };
    }

    private pushHistory(stack: MobileTabEntry[], entry?: MobileTabEntry) {
        if (!entry) {
            return;
        }
        stack.push({
            ...entry,
            action: [...entry.action],
            scroll: entry.scroll ? {...entry.scroll} : undefined,
        });
        if (stack.length > MAX_HISTORY) {
            stack.splice(0, stack.length - MAX_HISTORY);
        }
    }

    private createTab(current?: MobileTabEntry) {
        const tab: MobileTab = {
            id: genUUID(),
            current,
            backStack: [],
            forwardStack: [],
            activeAt: Date.now(),
        };
        this.state.tabs.push(tab);
        this.state.activeTabID = tab.id;
        this.trimTabs();
        return tab;
    }

    private trimTabs() {
        while (this.state.tabs.length > this.maxTabs) {
            const inactive = this.state.tabs
                .filter((item) => item.id !== this.state.activeTabID)
                .sort((a, b) => a.activeAt - b.activeAt)[0];
            if (!inactive) {
                break;
            }
            this.state.tabs.splice(this.state.tabs.indexOf(inactive), 1);
            if (inactive.current?.rootID) {
                fetchPost("/api/storage/updateRecentDocCloseTime", {rootID: inactive.current.rootID});
            }
        }
    }

    private resolveRoot(id: string, notebookId?: string, signal?: AbortSignal) {
        return new Promise<{rootID: string; box: string}>((resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true});
            const data: IObject = {id};
            if (notebookId) {
                data.notebook = notebookId;
            }
            let handled = false;
            // 仅取消导航状态，不中止底层请求，避免部分 WebView 的 fetch 包装层将 AbortError 暴露为未处理异常。
            void fetchPost("/api/block/getBlockInfo", data, (response) => {
                handled = true;
                if (response.code === 0 && response.data?.rootID) {
                    resolve(response.data);
                } else {
                    reject(new InvalidMobileTabTargetError(response.msg));
                }
            }).then(() => {
                if (!handled && !signal?.aborted) {
                    reject(new Error("Failed to resolve mobile tab target"));
                }
            });
        });
    }

    async open(id: string, options: OpenOptions = {}): Promise<MobileTabOpenResult> {
        const action = options.action || [Constants.CB_GET_HL];
        this.abortController?.abort();
        const abortController = new AbortController();
        this.abortController = abortController;
        const epoch = ++this.navigationEpoch;
        let info: {rootID: string; box: string};
        try {
            info = await this.resolveRoot(id, options.notebookId, abortController.signal);
        } catch (error) {
            if (abortController.signal.aborted) {
                return "cancelled";
            }
            return error instanceof InvalidMobileTabTargetError ? "invalid" : "failed";
        }
        if (epoch !== this.navigationEpoch) {
            return "cancelled";
        }

        this.snapshot();
        const activeBefore = this.activeTab;
        let tab: MobileTab;
        if (options.tabID) {
            tab = this.state.tabs.find((item) => item.id === options.tabID);
        } else if (!options.newTab) {
            tab = [...this.state.tabs]
                .filter((item) => item.current?.rootID === info.rootID)
                .sort((a, b) => b.activeAt - a.activeAt)[0];
        }
        tab ||= this.activeTab;
        const switchedExisting = !!tab && tab.id !== activeBefore?.id && !options.newTab;
        const createOnSuccess = options.newTab || !tab;
        if (createOnSuccess) {
            tab = {
                id: genUUID(),
                backStack: [],
                forwardStack: [],
                activeAt: Date.now(),
            };
        }
        const previous = tab.current;
        const restoreExistingPosition = switchedExisting && id === info.rootID &&
            action.includes(Constants.CB_GET_SCROLL);
        const loadID = restoreExistingPosition && previous ? previous.id : id;
        const loadAction = restoreExistingPosition ? [Constants.CB_GET_SCROLL] as TProtyleAction[] : action;
        const loadScroll = restoreExistingPosition ? previous?.scroll : options.scroll;
        const shouldReplace = options.replace || restoreExistingPosition || previous?.id === id;
        const targetTabID = tab.id;
        return new Promise<MobileTabOpenResult>((resolve) => {
            let settled = false;
            const finish = (result: MobileTabOpenResult) => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(result);
            };
            abortController.signal.addEventListener("abort", () => finish("cancelled"), {once: true});
            // 过期响应由 epoch 和 isValid 丢弃，不向 fetch 传递 signal。
            loadMobileFileById(this.app, loadID, loadAction, options.scrollPosition, info.box, (protyle) => {
                if (epoch !== this.navigationEpoch) {
                    finish("cancelled");
                    return;
                }
                if (!createOnSuccess && !this.state.tabs.some((item) => item.id === targetTabID)) {
                    finish("cancelled");
                    return;
                }
                if (!shouldReplace) {
                    this.pushHistory(tab.backStack, previous);
                    tab.forwardStack = [];
                }
                if (createOnSuccess) {
                    this.state.tabs.push(tab);
                }
                tab.current = this.entryFromProtyle(loadID, loadAction, protyle);
                tab.activeAt = Date.now();
                this.state.activeTabID = tab.id;
                this.trimTabs();
                window.siyuan.storage[Constants.LOCAL_DOCINFO] = {id: loadID};
                setStorageVal(Constants.LOCAL_DOCINFO, {id: loadID});
                this.persist();
                this.updateCounter();
                const previousRootID = options.recentPreviousRootID || previous?.rootID;
                if (switchedExisting || previousRootID === protyle.block.rootID) {
                    updateRecentDocSwitchTime({type: "view", rootID: protyle.block.rootID});
                } else if (previousRootID) {
                    updateRecentDocSwitchTime({
                        type: "switch",
                        rootID: protyle.block.rootID,
                        previousRootID,
                    });
                } else {
                    updateRecentDocSwitchTime({type: "open", rootID: protyle.block.rootID});
                }
                finish("success");
                options.afterOpen?.(protyle);
            }, options.forceReload, () => epoch === this.navigationEpoch, undefined, loadScroll, false, (invalid) => {
                finish(abortController.signal.aborted ? "cancelled" : (invalid ? "invalid" : "failed"));
            });
        });
    }

    openInNewTab(id: string, options: Omit<OpenOptions, "newTab"> = {}) {
        return this.open(id, {...options, newTab: true});
    }

    async restore(): Promise<boolean> {
        const tab = this.activeTab;
        if (!tab) {
            setEmpty(this.app);
            return false;
        }
        tab.activeAt = Date.now();
        if (!tab.current) {
            setEmpty(this.app);
            this.persist();
            this.updateCounter();
            return true;
        }
        const result = await this.open(tab.current.id, {
            action: [Constants.CB_GET_SCROLL],
            notebookId: tab.current.notebookID,
            forceReload: true,
            replace: true,
            scroll: tab.current.scroll,
            tabID: tab.id,
        });
        if (result === "invalid") {
            this.state.tabs = this.state.tabs.filter((item) => item.id !== tab.id);
            this.state.activeTabID = [...this.state.tabs].sort((a, b) => b.activeAt - a.activeAt)[0]?.id;
            this.persist();
            this.updateCounter();
            return this.restore();
        }
        if (result === "failed") {
            setEmpty(this.app);
        }
        return true;
    }

    createBlank() {
        this.cancelNavigation();
        this.snapshot();
        this.createTab();
        setEmpty(this.app);
        this.persist();
        this.updateCounter();
    }

    activateStartupBlank() {
        this.cancelNavigation();
        this.snapshot();
        const tab = [...this.state.tabs]
            .filter((item) => !item.current)
            .sort((a, b) => b.activeAt - a.activeAt)[0];
        if (!tab) {
            this.createBlank();
            return;
        }
        tab.activeAt = Date.now();
        this.state.activeTabID = tab.id;
        setEmpty(this.app);
        this.persist();
        this.updateCounter();
    }

    async switchTo(tabID: string) {
        const tab = this.state.tabs.find((item) => item.id === tabID);
        if (!tab || tab.id === this.state.activeTabID) {
            closeModel();
            return !!tab;
        }
        this.snapshot();
        if (tab.current) {
            const result = await this.open(tab.current.id, {
                action: [Constants.CB_GET_SCROLL],
                notebookId: tab.current.notebookID,
                forceReload: true,
                replace: true,
                scroll: tab.current.scroll,
                tabID: tab.id,
            });
            if (result === "invalid" || result === "failed") {
                await this.restore();
                return false;
            }
        } else {
            this.cancelNavigation();
            this.state.activeTabID = tab.id;
            tab.activeAt = Date.now();
            setEmpty(this.app);
            this.persist();
            this.updateCounter();
        }
        closeModel();
        return true;
    }

    async goBack(): Promise<boolean> {
        const tab = this.activeTab;
        if (!tab?.backStack.length) {
            return false;
        }
        this.snapshot(tab);
        const target = tab.backStack.pop();
        const previous = tab.current;
        const previousRootID = tab.current?.rootID;
        this.pushHistory(tab.forwardStack, tab.current);
        tab.current = target;
        this.persist();
        const result = await this.open(target.id, {
            action: [Constants.CB_GET_SCROLL],
            notebookId: target.notebookID,
            forceReload: true,
            replace: true,
            scroll: target.scroll,
            tabID: tab.id,
            recentPreviousRootID: previousRootID,
        });
        if (result === "invalid" || result === "failed") {
            tab.current = previous;
            tab.forwardStack.pop();
            this.persist();
            if (result === "invalid") {
                return this.goBack();
            }
            await this.restore();
        }
        return true;
    }

    async goForward(): Promise<boolean> {
        const tab = this.activeTab;
        if (!tab?.forwardStack.length) {
            return false;
        }
        this.snapshot(tab);
        const target = tab.forwardStack.pop();
        const previous = tab.current;
        const previousRootID = tab.current?.rootID;
        this.pushHistory(tab.backStack, tab.current);
        tab.current = target;
        this.persist();
        const result = await this.open(target.id, {
            action: [Constants.CB_GET_SCROLL],
            notebookId: target.notebookID,
            forceReload: true,
            replace: true,
            scroll: target.scroll,
            tabID: tab.id,
            recentPreviousRootID: previousRootID,
        });
        if (result === "invalid" || result === "failed") {
            tab.current = previous;
            tab.backStack.pop();
            this.persist();
            if (result === "invalid") {
                return this.goForward();
            }
            await this.restore();
        }
        return true;
    }

    async close(tabID: string) {
        const index = this.state.tabs.findIndex((item) => item.id === tabID);
        if (index < 0) {
            return;
        }
        const wasActive = this.state.activeTabID === tabID;
        if (wasActive) {
            this.cancelNavigation();
        }
        const closedRootID = this.state.tabs[index].current?.rootID;
        this.state.tabs.splice(index, 1);
        if (closedRootID) {
            fetchPost("/api/storage/updateRecentDocCloseTime", {rootID: closedRootID});
        }
        if (wasActive) {
            this.state.activeTabID = undefined;
            const next = [...this.state.tabs].sort((a, b) => b.activeAt - a.activeAt)[0];
            if (next?.current) {
                const opened = await this.switchTo(next.id);
                if (!opened) {
                    setEmpty(this.app);
                }
            } else {
                this.state.activeTabID = next?.id;
                if (next) {
                    next.activeAt = Date.now();
                }
                setEmpty(this.app);
            }
        }
        this.persist();
        this.updateCounter();
        if (wasActive) {
            closeModel();
        } else {
            this.openOverview();
        }
    }

    closeAll() {
        this.cancelNavigation();
        this.state.tabs.forEach((tab) => {
            if (tab.current?.rootID) {
                fetchPost("/api/storage/updateRecentDocCloseTime", {rootID: tab.current.rootID});
            }
        });
        this.state = {version: 1, tabs: []};
        setEmpty(this.app);
        this.persist();
        this.updateCounter();
        closeModel();
    }

    removeNotebook(notebookID: string) {
        this.state.tabs.forEach((tab) => {
            if (tab.current?.notebookID === notebookID) {
                fetchPost("/api/storage/updateRecentDocCloseTime", {rootID: tab.current.rootID});
            }
        });
        this.filterEntries((entry) => entry.notebookID !== notebookID);
    }

    removeRoots(rootIDs: string[]) {
        if (rootIDs.length === 0) {
            return;
        }
        const roots = new Set(rootIDs);
        this.state.tabs.forEach((tab) => {
            if (tab.current && roots.has(tab.current.rootID)) {
                fetchPost("/api/storage/updateRecentDocCloseTime", {rootID: tab.current.rootID});
            }
        });
        this.filterEntries((entry) => !roots.has(entry.rootID));
    }

    private filterEntries(predicate: (entry: MobileTabEntry) => boolean) {
        const activeTabID = this.state.activeTabID;
        this.state.tabs.forEach((tab) => {
            tab.backStack = tab.backStack.filter(predicate);
            tab.forwardStack = tab.forwardStack.filter(predicate);
        });
        this.state.tabs = this.state.tabs.filter((tab) => !tab.current || predicate(tab.current));
        if (!this.state.tabs.some((tab) => tab.id === activeTabID)) {
            this.cancelNavigation();
            this.state.activeTabID = [...this.state.tabs].sort((a, b) => b.activeAt - a.activeAt)[0]?.id;
            if (this.state.activeTabID) {
                void this.restore();
            } else {
                setEmpty(this.app);
            }
        }
        this.persist();
        this.updateCounter();
    }

    save() {
        this.snapshot();
        this.persist();
    }

    pushCurrent() {
        const tab = this.activeTab;
        if (!tab?.current) {
            return;
        }
        this.snapshot(tab);
        this.pushHistory(tab.backStack, tab.current);
        tab.forwardStack = [];
        this.persist();
    }

    openOverview() {
        const active = this.state.activeTabID;
        const rows = this.state.tabs.map((tab) => `<div class="mobile-tabs__item${tab.id === active ? " mobile-tabs__item--active" : ""}" data-tab-id="${escapeAttr(tab.id)}">
    <svg class="mobile-tabs__item-icon"><use xlink:href="#iconFile"></use></svg>
    <span class="mobile-tabs__item-title">${escapeHtml(tab.current?.title || window.siyuan.languages.newTab)}</span>
    <button class="b3-button b3-button--text mobile-tabs__close" data-action="close" aria-label="${escapeAttr(window.siyuan.languages.close)}">
        <svg><use xlink:href="#iconClose"></use></svg>
    </button>
</div>`).join("");
        const tab = this.activeTab;
        openModel({
            title: `${window.siyuan.languages.mobileTabs} ${this.state.tabs.length}`,
            html: `<div class="mobile-tabs">
    <div class="mobile-tabs__list">${rows || `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`}</div>
    <div class="mobile-tabs__actions">
        <button class="b3-button b3-button--outline" data-action="back"${tab?.backStack.length ? "" : " disabled"}><svg><use xlink:href="#iconLeft"></use></svg>${window.siyuan.languages.goBack}</button>
        <button class="b3-button b3-button--outline" data-action="forward"${tab?.forwardStack.length ? "" : " disabled"}><svg><use xlink:href="#iconRight"></use></svg>${window.siyuan.languages.goForward}</button>
        <button class="b3-button b3-button--outline" data-action="new-doc"><svg><use xlink:href="#iconAddDoc"></use></svg>${window.siyuan.languages.newFile}</button>
        <button class="b3-button b3-button--outline" data-action="close-all"${this.state.tabs.length ? "" : " disabled"}><svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.closeAll}</button>
    </div>
</div>`,
            bindEvent: (element) => {
                element.querySelectorAll<HTMLElement>("[data-action]").forEach((target) => {
                    target.addEventListener("click", (event) => {
                        event.stopPropagation();
                        const action = target.dataset.action;
                        const tabID = target.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
                        if (action === "close" && tabID) {
                            void this.close(tabID);
                        } else if (action === "back") {
                            void this.goBack().then(() => closeModel());
                        } else if (action === "forward") {
                            void this.goForward().then(() => closeModel());
                        } else if (action === "new-doc") {
                            closeModel();
                            newFile(this.app);
                        } else if (action === "close-all") {
                            this.closeAll();
                        }
                    });
                });
                element.querySelectorAll<HTMLElement>("[data-tab-id]").forEach((target) => {
                    target.addEventListener("click", () => {
                        const tabID = target.dataset.tabId;
                        if (tabID) {
                            void this.switchTo(tabID);
                        }
                    });
                });
            },
        });
    }
}
