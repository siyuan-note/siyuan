import {Constants} from "../../constants";
import {unicode2Emoji} from "../../emoji";
import type {App} from "../../index";
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

export class MobileTabs {
    private state: MobileTabsState;
    private navigationEpoch = 0;
    private abortController?: AbortController;
    private activationBackStack: string[] = [];
    private activationForwardStack: string[] = [];

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
        while (this.state.tabs.length > this.maxTabs) {
            const inactive = this.state.tabs
                .filter((item) => item.id !== this.state.activeTabID)
                .sort((a, b) => a.activeAt - b.activeAt)[0];
            if (!inactive) {
                break;
            }
            this.state.tabs.splice(this.state.tabs.indexOf(inactive), 1);
            this.removeActivation(inactive.id);
            if (inactive.current?.rootID) {
                fetchPost("/api/storage/updateRecentDocCloseTime", {rootID: inactive.current.rootID});
            }
        }
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

    private filterEntries(predicate: (entry: MobileTabEntry) => boolean) {
        const activeTabID = this.state.activeTabID;
        this.state.tabs.forEach((tab) => {
            tab.backStack = tab.backStack.filter(predicate);
            tab.forwardStack = tab.forwardStack.filter(predicate);
        });
        this.state.tabs = this.state.tabs.filter((tab) => !tab.current || predicate(tab.current));
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

    openOverview() {
        this.snapshot();
        this.persist();
        const active = this.state.activeTabID;
        const rows = this.state.tabs.map((tab) => {
            const iconHTML = tab.current ? unicode2Emoji(
                tab.current.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].file,
                "mobile-tabs__item-icon",
                true,
            ) : '<svg class="mobile-tabs__item-icon"><use xlink:href="#iconFile"></use></svg>';
            return `<div class="mobile-tabs__item${tab.id === active ? " mobile-tabs__item--active" : ""}" data-tab-id="${escapeAttr(tab.id)}">
    ${iconHTML}
    <span class="mobile-tabs__item-title">${escapeHtml(tab.current?.title || window.siyuan.languages.newTab)}</span>
    <button class="b3-button b3-button--text mobile-tabs__close" data-action="close" aria-label="${escapeAttr(window.siyuan.languages.close)}">
        <svg><use xlink:href="#iconClose"></use></svg>
    </button>
</div>`;
        }).join("");
        const tab = this.activeTab;
        openModel({
            title: `${window.siyuan.languages.mobileTabs} ${this.state.tabs.length}`,
            html: `<div class="mobile-tabs">
    <div class="mobile-tabs__list">${rows || `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`}</div>
    <div class="mobile-tabs__actions">
        <button class="b3-button b3-button--outline" data-action="back"${tab?.backStack.length || this.hasActivationTarget(this.activationBackStack) ? "" : " disabled"}><svg><use xlink:href="#iconLeft"></use></svg>${window.siyuan.languages.goBack}</button>
        <button class="b3-button b3-button--outline" data-action="forward"${tab?.forwardStack.length || this.hasActivationTarget(this.activationForwardStack) ? "" : " disabled"}><svg><use xlink:href="#iconRight"></use></svg>${window.siyuan.languages.goForward}</button>
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
                requestAnimationFrame(() => {
                    const listElement = element.querySelector<HTMLElement>(".mobile-tabs__list");
                    const activeElement = listElement?.querySelector<HTMLElement>(".mobile-tabs__item--active");
                    if (!listElement || !activeElement) {
                        return;
                    }
                    const listRect = listElement.getBoundingClientRect();
                    const activeRect = activeElement.getBoundingClientRect();
                    listElement.scrollTop += activeRect.top - listRect.top - (listRect.height - activeRect.height) / 2;
                });
            },
        });
    }
}
