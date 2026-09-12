import {Constants} from "../../constants";
import {getDocumentIconHTML} from "../../emoji/fileTreeIcon";
import type {App} from "../../index";
import {MenuItem} from "../../menus/Menu";
import {saveScroll} from "../../protyle/scroll/saveScroll";
import {setStorageVal} from "../../protyle/util/compatibility";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {genUUID} from "../../util/genID";
import {newFile} from "../../util/newFile";
import {isEncryptedBox} from "../../util/pathName";
import {loadMobileFileById, updateRecentDocSwitchTime} from "../editor";
import {openModel} from "../menu/model";
import {closeModel} from "../util/closePanel";
import {setEmpty} from "../util/setEmpty";
import {canCloseTab, moveTab, orderTabsForOverview, toggleTabPin, trimTabsToLimit} from "./mobileTabsState";

const MAX_HISTORY = 32;

export type MobileTabEntry = {
    id: string;
    rootID: string;
    notebookID: string;
    path: string;
    title: string;
    icon?: string;
    action: TProtyleAction[];
    scroll?: IScrollAttr;
};

type MobileTab = {
    id: string;
    current?: MobileTabEntry;
    backStack: MobileTabEntry[];
    forwardStack: MobileTabEntry[];
    activeAt: number;
    /**
     * 钉住的页签不参与超限淘汰，在概览列表中置顶
     */
    pin?: boolean;
};

type MobileTabsState = {
    version: 1;
    activeTabID?: string;
    tabs: MobileTab[];
    activationBackStack?: string[];
    activationForwardStack?: string[];
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
    recordActivation?: boolean;
};

type MobileTabOpenResult = "success" | "cancelled" | "invalid" | "failed";

class InvalidMobileTabTargetError extends Error {
}

const normalizeEntry = (value: unknown): MobileTabEntry | undefined => {
    const entry = value as MobileTabEntry;
    if (!entry || typeof entry.id !== "string" || typeof entry.rootID !== "string" ||
        typeof entry.notebookID !== "string" || typeof entry.path !== "string" ||
        typeof entry.title !== "string" || !Array.isArray(entry.action)) {
        return;
    }
    return {
        ...entry,
        icon: typeof entry.icon === "string" ? entry.icon : undefined,
    };
};

const normalizeTab = (value: unknown): MobileTab | undefined => {
    const tab = value as MobileTab;
    if (!tab || typeof tab.id !== "string") {
        return;
    }
    return {
        id: tab.id,
        current: normalizeEntry(tab.current),
        backStack: Array.isArray(tab.backStack) ?
            tab.backStack.map(normalizeEntry).filter((item): item is MobileTabEntry => !!item).slice(-MAX_HISTORY) : [],
        forwardStack: Array.isArray(tab.forwardStack) ?
            tab.forwardStack.map(normalizeEntry).filter((item): item is MobileTabEntry => !!item).slice(-MAX_HISTORY) : [],
        activeAt: typeof tab.activeAt === "number" ? tab.activeAt : 0,
        pin: tab.pin === true,
    };
};

const sanitizeEntry = (entry?: MobileTabEntry) => entry && !isEncryptedBox(entry.notebookID) ? entry : undefined;

const sanitizeTab = (tab: MobileTab): MobileTab => {
    return {
        ...tab,
        current: sanitizeEntry(tab.current),
        backStack: tab.backStack.filter((entry) => !!sanitizeEntry(entry)),
        forwardStack: tab.forwardStack.filter((entry) => !!sanitizeEntry(entry)),
    };
};

const getTabTitle = (tab: MobileTab) => tab.current?.title || window.siyuan.languages.newTab;

const getTabIconHTML = (tab: MobileTab) => getDocumentIconHTML(
    tab.current?.icon || "",
    "mobile-tabs__item-icon",
    // 没有图标时始终使用默认 SVG 图标做占位，不跟随 useSVGDefaultIcon 设置
    true,
);

const getPinIcon = (pinned: boolean) => pinned ? "iconUnpin" : "iconPin";

export class MobileTabs {
    private state: MobileTabsState;
    private navigationEpoch = 0;
    private abortController?: AbortController;
    private activationBackStack: string[] = [];
    private activationForwardStack: string[] = [];
    private overviewElement?: HTMLElement;
    private overviewLongPressTimer?: number;
    private overviewLongPressTabID?: string;
    private overviewLongPressTriggered = false;
    private suppressOverviewClickUntil = 0;
    private overviewPointerX?: number;
    private overviewPointerY?: number;

    constructor(private readonly app: App) {
        const stored = window.siyuan.storage[Constants.LOCAL_MOBILE_TABS] as MobileTabsState | undefined;
        const tabs = stored?.version === 1 && Array.isArray(stored.tabs) ?
            stored.tabs.map(normalizeTab).filter((item): item is MobileTab => !!item).map(sanitizeTab) : [];
        this.state = {
            version: 1,
            activeTabID: tabs.some((item) => item.id === stored?.activeTabID) ? stored.activeTabID : tabs[0]?.id,
            tabs,
        };
        const tabIDs = new Set(tabs.map((tab) => tab.id));
        this.activationBackStack = Array.isArray(stored?.activationBackStack) ?
            stored.activationBackStack.filter((tabID) => typeof tabID === "string" && tabIDs.has(tabID)).slice(-MAX_HISTORY) : [];
        this.activationForwardStack = Array.isArray(stored?.activationForwardStack) ?
            stored.activationForwardStack.filter((tabID) => typeof tabID === "string" && tabIDs.has(tabID)).slice(-MAX_HISTORY) : [];
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

    private pushActivation(stack: string[], tabID?: string) {
        if (!tabID || stack[stack.length - 1] === tabID) {
            return;
        }
        stack.push(tabID);
        if (stack.length > MAX_HISTORY) {
            stack.splice(0, stack.length - MAX_HISTORY);
        }
    }

    private recordActivation(tabID?: string) {
        this.pushActivation(this.activationBackStack, tabID);
        this.activationForwardStack = [];
    }

    private removeActivation(tabID: string) {
        this.activationBackStack = this.activationBackStack.filter((item) => item !== tabID);
        this.activationForwardStack = this.activationForwardStack.filter((item) => item !== tabID);
    }

    private hasActivationTarget(stack: string[]) {
        return stack.some((tabID) => tabID !== this.state.activeTabID &&
            this.state.tabs.some((tab) => tab.id === tabID));
    }

    private persist() {
        const persistedState: MobileTabsState = {
            version: 1,
            activeTabID: this.state.activeTabID,
            tabs: this.state.tabs.map(sanitizeTab),
            activationBackStack: this.activationBackStack,
            activationForwardStack: this.activationForwardStack,
        };
        window.siyuan.storage[Constants.LOCAL_MOBILE_TABS] = persistedState;
        setStorageVal(Constants.LOCAL_MOBILE_TABS, persistedState);
        this.updateNavigationButtons();
    }

    private updateCounter() {
        const countElement = document.querySelector("#toolbarTabs .toolbar__tabs-count");
        if (countElement) {
            countElement.textContent = this.state.tabs.length.toString();
        }
    }

    private updateNavigationButtons() {
        const backElement = document.getElementById("mobileBottomBarBack") as HTMLButtonElement;
        const forwardElement = document.getElementById("mobileBottomBarForward") as HTMLButtonElement;
        if (backElement) {
            backElement.disabled = !this.canGoBack();
        }
        if (forwardElement) {
            forwardElement.disabled = !this.canGoForward();
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
            tab.current.icon = protyle.background?.ial?.icon || "";
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
            icon: protyle.background?.ial?.icon || "",
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
        this.state.tabs = trimTabsToLimit(this.state.tabs, this.state.activeTabID, this.maxTabs, (tab) => {
            this.removeActivation(tab.id);
            if (tab.current?.rootID) {
                fetchPost("/api/storage/updateRecentDocCloseTime", {rootID: tab.current.rootID});
            }
        });
    }

    async removeMissingTabs() {
        const rootIDs = [...new Set(this.state.tabs.map((tab) => tab.current?.rootID).filter((rootID): rootID is string => !!rootID))];
        if (rootIDs.length === 0) {
            return;
        }
        let response: IWebSocketData;
        try {
            response = await fetchSyncPost("/api/block/checkBlocksExist", {ids: rootIDs});
        } catch (error) {
            console.warn("check mobile tabs failed", error);
            return;
        }
        if (response.code !== 0 || !response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
            return;
        }
        const missingRootIDs = new Set(rootIDs.filter((rootID) => response.data[rootID] === false));
        if (missingRootIDs.size === 0) {
            return;
        }
        const activeTabID = this.state.activeTabID;
        this.state.tabs.forEach((tab) => {
            tab.backStack = tab.backStack.filter((entry) => !missingRootIDs.has(entry.rootID));
            tab.forwardStack = tab.forwardStack.filter((entry) => !missingRootIDs.has(entry.rootID));
        });
        this.state.tabs = this.state.tabs.filter((tab) => !tab.current || !missingRootIDs.has(tab.current.rootID));
        this.activationBackStack = this.activationBackStack.filter((tabID) =>
            this.state.tabs.some((tab) => tab.id === tabID));
        this.activationForwardStack = this.activationForwardStack.filter((tabID) =>
            this.state.tabs.some((tab) => tab.id === tabID));
        if (!this.state.tabs.some((tab) => tab.id === activeTabID)) {
            this.state.activeTabID = [...this.state.tabs].sort((a, b) => b.activeAt - a.activeAt)[0]?.id;
        }
        this.persist();
        this.updateCounter();
    }

    private resolveRoot(id: string, notebookId?: string, signal?: AbortSignal) {
        return new Promise<{rootID: string; box?: string}>((resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true});
            const data: {id: string; notebook?: string} = {id};
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
        let info: {rootID: string; box?: string};
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
        if (!tab && !options.newTab && (!this.activeTab?.current || this.maxTabs === 1)) {
            tab = this.activeTab;
        }
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
                if (options.recordActivation !== false && activeBefore?.id !== tab.id) {
                    this.recordActivation(activeBefore?.id);
                }
                this.state.activeTabID = tab.id;
                this.trimTabs();
                const docInfo = isEncryptedBox(protyle.notebookId) ? {id: ""} : {id: loadID};
                window.siyuan.storage[Constants.LOCAL_DOCINFO] = docInfo;
                setStorageVal(Constants.LOCAL_DOCINFO, docInfo);
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

    async switchTo(tabID: string, recordActivation = true) {
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
                recordActivation,
            });
            if (result === "invalid" || result === "failed") {
                await this.restore();
                return false;
            }
        } else {
            this.cancelNavigation();
            if (recordActivation) {
                this.recordActivation(this.state.activeTabID);
            }
            this.state.activeTabID = tab.id;
            tab.activeAt = Date.now();
            setEmpty(this.app);
            this.persist();
            this.updateCounter();
        }
        closeModel();
        return true;
    }

    async switchPreviousTab(): Promise<boolean> {
        while (this.activationBackStack.length > 0) {
            const tabID = this.activationBackStack.pop();
            if (tabID !== this.state.activeTabID && this.state.tabs.some((tab) => tab.id === tabID)) {
                const activeTabID = this.state.activeTabID;
                if (await this.switchTo(tabID, false)) {
                    this.pushActivation(this.activationForwardStack, activeTabID);
                    this.persist();
                    return true;
                }
            }
        }
        return false;
    }

    async switchNextTab(): Promise<boolean> {
        while (this.activationForwardStack.length > 0) {
            const tabID = this.activationForwardStack.pop();
            if (tabID !== this.state.activeTabID && this.state.tabs.some((tab) => tab.id === tabID)) {
                const activeTabID = this.state.activeTabID;
                if (await this.switchTo(tabID, false)) {
                    this.pushActivation(this.activationBackStack, activeTabID);
                    this.persist();
                    return true;
                }
            }
        }
        return false;
    }

    canGoBack() {
        return Boolean(this.activeTab?.backStack.length) || this.hasActivationTarget(this.activationBackStack);
    }

    canGoForward() {
        return Boolean(this.activeTab?.forwardStack.length) || this.hasActivationTarget(this.activationForwardStack);
    }

    async goBack(): Promise<boolean> {
        const tab = this.activeTab;
        if (!tab?.backStack.length) {
            return this.switchPreviousTab();
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
            recordActivation: false,
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
            return this.switchNextTab();
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
            recordActivation: false,
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
        this.removeActivation(tabID);
        if (closedRootID) {
            fetchPost("/api/storage/updateRecentDocCloseTime", {rootID: closedRootID});
        }
        if (wasActive) {
            this.state.activeTabID = undefined;
            const next = [...this.state.tabs].sort((a, b) => b.activeAt - a.activeAt)[0];
            if (next?.current) {
                const opened = await this.switchTo(next.id, false);
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
        // 钉住的页签不参与关闭全部
        const pinnedTabs = this.state.tabs.filter((tab) => !!tab.pin);
        if (pinnedTabs.length > 0) {
            const keptIDs = new Set(pinnedTabs.map((tab) => tab.id));
            this.filterEntries((_entry, entryTabID) => keptIDs.has(entryTabID));
            if (!pinnedTabs.some((tab) => tab.id === this.state.activeTabID)) {
                const nextTab = [...pinnedTabs].sort((a, b) => b.activeAt - a.activeAt)[0];
                if (nextTab) {
                    void this.switchTo(nextTab.id, false);
                }
            }
            window.siyuan.menus.menu.remove();
            this.renderOverview();
            return;
        }
        this.cancelNavigation();
        this.state.tabs.forEach((tab) => {
            if (tab.current?.rootID) {
                fetchPost("/api/storage/updateRecentDocCloseTime", {rootID: tab.current.rootID});
            }
        });
        this.state = {version: 1, tabs: []};
        this.activationBackStack = [];
        this.activationForwardStack = [];
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

    private filterEntries(predicate: (entry: MobileTabEntry, tabID: string) => boolean) {
        const activeTabID = this.state.activeTabID;
        this.state.tabs.forEach((tab) => {
            tab.backStack = tab.backStack.filter((entry) => predicate(entry, tab.id));
            tab.forwardStack = tab.forwardStack.filter((entry) => predicate(entry, tab.id));
        });
        this.state.tabs = this.state.tabs.filter((tab) => !tab.current || predicate(tab.current, tab.id));
        this.activationBackStack = this.activationBackStack.filter((tabID) =>
            this.state.tabs.some((tab) => tab.id === tabID));
        this.activationForwardStack = this.activationForwardStack.filter((tabID) =>
            this.state.tabs.some((tab) => tab.id === tabID));
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

    private openTabMenu(tabID: string) {
        const tab = this.state.tabs.find((item) => item.id === tabID);
        if (!tab) {
            return;
        }
        const pinned = !!tab.pin;
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_MOBILE_TABS);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "close",
            icon: "iconClose",
            label: window.siyuan.languages.close,
            click: () => {
                void this.close(tabID);
            },
        }).element);
        if (this.state.tabs.length > 1) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "closeOthers",
                label: window.siyuan.languages.closeOthers,
                click: () => {
                    this.closeOthers(tabID);
                },
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                id: "closeAll",
                label: window.siyuan.languages.closeAll,
                click: () => {
                    this.closeAll();
                },
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: pinned ? "unpin" : "pin",
            icon: getPinIcon(pinned),
            label: pinned ? window.siyuan.languages.unpin : window.siyuan.languages.pin,
            click: () => {
                this.togglePin(tabID);
            },
        }).element);
        window.siyuan.menus.menu.fullscreen("bottom");
    }

    private togglePin(tabID: string) {
        const tab = this.state.tabs.find((item) => item.id === tabID);
        if (!tab) {
            return;
        }
        this.state.tabs = toggleTabPin(this.state.tabs, tabID);
        // 钉住状态随页签列表持久化
        this.persist();
        this.renderOverview();
        window.siyuan.menus.menu.remove();
    }

    private closeOthers(tabID: string) {
        if (!this.state.tabs.some((item) => item.id === tabID)) {
            return;
        }
        // 钉住的页签不参与关闭其他
        const keptIDs = new Set(this.state.tabs
            .filter((item) => item.id === tabID || !!item.pin)
            .map((item) => item.id));
        this.filterEntries((_entry, entryTabID) => keptIDs.has(entryTabID));
        window.siyuan.menus.menu.remove();
        this.renderOverview();
    }

    private renderOverview() {
        // 钉住的页签置顶显示，靠图钉图标区分，不额外加分组标题或分隔线
        const rows = orderTabsForOverview(this.state.tabs)
            .map((tab) => this.renderOverviewItem(tab)).join("");
        openModel({
            title: `${window.siyuan.languages.mobileTabs} ${this.state.tabs.length}`,
            html: `<div class="mobile-tabs" data-name="${escapeAttr(Constants.MENU_MOBILE_TABS_OVERVIEW)}">
    <div class="mobile-tabs__list">${rows || `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`}</div>
    <div class="mobile-tabs__actions">
        <button class="b3-button b3-button--outline" data-action="back"${this.canGoBack() ? "" : " disabled"}><svg><use xlink:href="#iconLeft"></use></svg>${window.siyuan.languages.goBack}</button>
        <button class="b3-button b3-button--outline" data-action="forward"${this.canGoForward() ? "" : " disabled"}><svg><use xlink:href="#iconRight"></use></svg>${window.siyuan.languages.goForward}</button>
        <button class="b3-button b3-button--outline" data-action="new-doc"><svg><use xlink:href="#iconAddDoc"></use></svg>${window.siyuan.languages.newFile}</button>
        <button class="b3-button b3-button--outline" data-action="close-all"${this.state.tabs.length ? "" : " disabled"}><svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.closeAll}</button>
    </div>
</div>`,
            bindEvent: (element) => {
                if (element !== this.overviewElement) {
                    // 每次渲染都会替换内容，事件绑定在固定的容器上
                    this.overviewElement = element;
                    this.bindOverviewEvents(element);
                }
            },
            destroyCallback: () => {
                this.cancelOverviewLongPress();
            },
        });
    }

    private renderOverviewItem(tab: MobileTab) {
        const pinned = !!tab.pin;
        const closeHidden = !canCloseTab(pinned);
        return `<div class="mobile-tabs__item${tab.id === this.state.activeTabID ? " mobile-tabs__item--active" : ""}" data-tab-id="${escapeAttr(tab.id)}">
    <span class="mobile-tabs__drag" data-action="drag"><svg><use xlink:href="#iconDrag"></use></svg></span>
    ${getTabIconHTML(tab)}
    <span class="mobile-tabs__item-title">${escapeHtml(getTabTitle(tab))}</span>
    <span class="mobile-tabs__item-pin${pinned ? "" : " fn__none"}" aria-hidden="${pinned ? "false" : "true"}" aria-label="${escapeAttr(window.siyuan.languages.pin)}"><svg><use xlink:href="#iconPin"></use></svg></span>
    <button class="b3-button b3-button--text mobile-tabs__close${closeHidden ? " fn__none" : ""}" data-action="close" aria-label="${escapeAttr(window.siyuan.languages.close)}">
        <svg><use xlink:href="#iconClose"></use></svg>
    </button>
</div>`;
    }

    private bindOverviewEvents(element: HTMLElement) {
        let drag: {pointerID: number; tabID: string; item: HTMLElement} | undefined;
        const finishDrag = (event: PointerEvent) => {
            if (!drag || drag.pointerID !== event.pointerId) {
                return;
            }
            drag.item.classList.remove("mobile-tabs__item--dragging");
            drag = undefined;
            if (element.hasPointerCapture(event.pointerId)) {
                element.releasePointerCapture(event.pointerId);
            }
            this.overviewLongPressTriggered = true;
            this.suppressOverviewClickUntil = Date.now() + Constants.TIMEOUT_LONGPRESS;
            this.persist();
        };
        element.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (this.overviewLongPressTriggered) {
                // 长按抬手时会补发 click，只忽略紧随长按的那一次
                this.overviewLongPressTriggered = false;
                if (Date.now() < this.suppressOverviewClickUntil) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }
            const actionElement = target.closest<HTMLElement>("[data-action]");
            if (actionElement) {
                const tabID = actionElement.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
                if (actionElement.dataset.action === "close" && tabID) {
                    void this.close(tabID);
                } else if (actionElement.dataset.action === "back") {
                    void this.goBack().then(() => closeModel());
                } else if (actionElement.dataset.action === "forward") {
                    void this.goForward().then(() => closeModel());
                } else if (actionElement.dataset.action === "new-doc") {
                    closeModel();
                    newFile(this.app);
                } else if (actionElement.dataset.action === "close-all") {
                    this.closeAll();
                }
                event.stopPropagation();
                return;
            }
            const itemElement = target.closest<HTMLElement>("[data-tab-id]");
            if (itemElement) {
                void this.switchTo(itemElement.dataset.tabId);
            }
        });

        const processPointerMove = (event: PointerEvent) => {
            if (drag) {
                if (drag.pointerID !== event.pointerId) {
                    return;
                }
                event.preventDefault();
                const list = drag.item.parentElement;
                const rect = list.getBoundingClientRect();
                if (event.clientY < rect.top + 48) {
                    list.scrollTop -= 16;
                } else if (event.clientY > rect.bottom - 148) {
                    list.scrollTop += 16;
                }
                const target = document.elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>("[data-tab-id]");
                if (target && target !== drag.item && target.parentElement === list) {
                    const after = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
                    this.state.tabs = moveTab(this.state.tabs, drag.tabID, target.dataset.tabId, after);
                    const nextID = this.state.tabs[this.state.tabs.findIndex((tab) => tab.id === drag.tabID) + 1]?.id;
                    const next = Array.from(list.children).find((child) => (child as HTMLElement).dataset.tabId === nextID);
                    list.insertBefore(drag.item, next || null);
                }
                return;
            }
            if (typeof this.overviewPointerX !== "number" || typeof this.overviewPointerY !== "number") {
                return;
            }
            if (Math.abs(event.clientX - this.overviewPointerX) > Constants.SIZE_DRAG_THRESHOLD ||
                Math.abs(event.clientY - this.overviewPointerY) > Constants.SIZE_DRAG_THRESHOLD) {
                // 滑动视为滚动列表，取消长按
                this.cancelOverviewLongPress();
            }
        };
        element.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || !event.isPrimary || drag) {
                return;
            }
            const itemElement = (event.target as HTMLElement).closest<HTMLElement>("[data-tab-id]");
            if (!itemElement) {
                return;
            }
            this.cancelOverviewLongPress();
            if ((event.target as HTMLElement).closest("[data-action='drag']")) {
                event.preventDefault();
                drag = {pointerID: event.pointerId, tabID: itemElement.dataset.tabId, item: itemElement};
                itemElement.classList.add("mobile-tabs__item--dragging");
                element.setPointerCapture(event.pointerId);
                return;
            }
            if ((event.target as HTMLElement).closest("[data-action]")) {
                return;
            }
            this.overviewPointerX = event.clientX;
            this.overviewPointerY = event.clientY;
            this.overviewLongPressTabID = itemElement.dataset.tabId;
            this.overviewLongPressTimer = window.setTimeout(() => {
                const tabID = this.overviewLongPressTabID;
                this.overviewLongPressTimer = undefined;
                this.overviewLongPressTabID = undefined;
                if (!tabID) {
                    return;
                }
                this.overviewLongPressTriggered = true;
                this.suppressOverviewClickUntil = Date.now() + Constants.TIMEOUT_LONGPRESS;
                this.openTabMenu(tabID);
            }, Constants.TIMEOUT_LONGPRESS);
        });
        element.addEventListener("pointermove", processPointerMove);
        element.addEventListener("pointerup", () => this.cancelOverviewLongPress());
        element.addEventListener("pointercancel", () => this.cancelOverviewLongPress());
        element.addEventListener("pointerup", finishDrag);
        element.addEventListener("pointercancel", finishDrag);
        element.addEventListener("lostpointercapture", finishDrag);
    }

    private cancelOverviewLongPress() {
        if (this.overviewLongPressTimer) {
            clearTimeout(this.overviewLongPressTimer);
            this.overviewLongPressTimer = undefined;
        }
        this.overviewLongPressTabID = undefined;
        this.overviewPointerX = undefined;
        this.overviewPointerY = undefined;
    }

    openOverview() {
        this.snapshot();
        this.persist();
        this.renderOverview();
    }
}
