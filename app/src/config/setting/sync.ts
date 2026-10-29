import {fetchSyncPost} from "../../util/fetch";
import type {SystemAppConf} from "../../types/api";
import {systemConfig} from "../systemConfig";
import {editorConfigApi} from "../tabs/editorRuntime";
import {exportConfigApi} from "../tabs/exportRuntime";
import {appearanceConfigApi} from "../tabs/appearanceRuntime";
import {aiConfigApi} from "../tabs/ai/aiRuntime";
import {objEquals} from "../../util/functions";
import {syncSettingTasks} from "./taskBlocker";
import {processSync} from "../../dialog/processSystem";
import {notifyOCRChanged} from "../ocrRuntime";
import {refreshMountedBazaar} from "../bazaarTab";
import {remountOpenSettingTab} from "./mount";
/// #if !MOBILE
import {applyKeymap} from "../tabs/keymapRuntime";
import {getSettingTabDefs, type TSettingTab} from "./tabs";
/// #endif

// 待刷新的配置域及触发它的段版本号，0 表示不含版本号的强制刷新。
let pending = new Map<string, number>();
let refreshing: Promise<void>;
let saving = 0;
let saved: Promise<void>;
let finishSaving: () => void;

// 内核为每次提交分配全局递增序号，同时记录到提交的配置段上。
// 按段读取会返回该段当前的版本号，与通知中的版本号相等时说明内容已应用，不再重复读取。
const sectionRevisions = new Map<string, number>();

const alreadyApplied = (namespace: string, revision?: number) =>
    typeof revision === "number" && namespace !== "*" && revision === sectionRevisions.get(namespace);

const queue = (namespace: string, revision = 0) => {
    const current = pending.get(namespace);
    if (current === undefined || revision > current) {
        pending.set(namespace, revision);
    }
};

// 只丢弃带版本号且已被本次读取覆盖的排队请求；不带版本号的主动刷新无法判断是否已覆盖，必须保留。
const dropCovered = (namespace: string, limit: number) => {
    if (namespace === "*") {
        pending.forEach((revision, key) => {
            if (revision > 0 && revision <= limit) pending.delete(key);
        });
        return;
    }
    const revision = pending.get(namespace);
    if (revision !== undefined && revision > 0 && revision <= limit) {
        pending.delete(namespace);
    }
};

const recordRevision = (namespace: string, revision: unknown) => {
    if (typeof revision !== "number") return;
    if (namespace === "*") {
        // 完整读取含全部配置段，各段的旧版本号不再有参考意义。
        sectionRevisions.clear();
    } else if (revision > 0) {
        sectionRevisions.set(namespace, revision);
    }
    dropCovered(namespace, revision);
};

// 等待配置写入完成，将保存回调与同次写入的广播合并为一次配置读取。
export const refreshSettingConfigAfter = async (namespace: string, save: () => Promise<boolean>) => {
    if (saving++ === 0) {
        saved = new Promise(resolve => { finishSaving = resolve; });
    }
    let changed: boolean;
    try {
        changed = await save();
    } finally {
        if (--saving === 0) finishSaving();
    }
    if (changed) await refreshSettingConfig(namespace);
    return changed;
};

const applySettingConfig = async (next: Config.IConf, namespaces: Set<string>) => {
    const includes = (key: string) => namespaces.has("*") || namespaces.has(key);
    if (includes("editor") && !objEquals(window.siyuan.config.editor, next.editor)) {
        await editorConfigApi.apply(next.editor);
    }
    if (includes("appearance") && !objEquals(window.siyuan.config.appearance, next.appearance)) {
        await appearanceConfigApi.apply(next.appearance);
    }
    if (includes("export") && !objEquals(window.siyuan.config.export, next.export)) {
        await exportConfigApi.apply(next.export);
    }
    if (includes("ai") && !objEquals(window.siyuan.config.ai, next.ai)) {
        await aiConfigApi.apply(next.ai);
    }
    if (includes("sync") && !objEquals(window.siyuan.config.sync, next.sync)) {
        window.siyuan.config.sync = next.sync;
        processSync();
    }
    let accessChanged = false;
    if (includes("system")) {
        accessChanged = window.siyuan.config.system?.encryptedNotebookFollowSystemLock !==
            next.system?.encryptedNotebookFollowSystemLock;
        // 系统设置通知同时同步访问授权的顶层配置，值以内核返回的脱敏配置为准。
        for (const key of ["api", "oidc", "accessAuthCode"] as const) {
            accessChanged ||= !objEquals(window.siyuan.config[key], next[key]);
            Object.assign(window.siyuan.config, {[key]: next[key]});
        }
    }
    /// #if !MOBILE
    if (includes("keymap") && !objEquals(window.siyuan.config.keymap, next.keymap)) {
        applyKeymap(next.keymap);
    }
    /// #else
    if (includes("keymap")) {
        window.siyuan.config.keymap = next.keymap;
    }
    /// #endif
    const simple = ["fileTree", "search", "flashcard", "secrets", "variables", "repo", "system", "bazaar", "publish", "ocr", "snippet", "tag", "graph", "uiLayout", "stat"] as const;
    for (const key of simple) {
        if (includes(key) && (key !== "graph" || !window.siyuan.config.readonly)) {
            Object.assign(window.siyuan.config, {[key]: next[key]});
        }
    }
    if (includes("ocr") && next.ocr) {
        notifyOCRChanged();
    }
    if (includes("bazaar")) {
        void refreshMountedBazaar();
    }
    /// #if !MOBILE
    const tabs: Record<string, TSettingTab> = {fileTree: "file", secrets: "secretsVariables", variables: "secretsVariables", system: "app", publish: "access"};
    const remountTabs = new Set<TSettingTab>();
    for (const key of namespaces.has("*") ? [...simple, "editor", "export", "keymap", "appearance", "ai", "sync"] : namespaces) {
        const tab = getSettingTabDefs().find(definition => definition.id === (tabs[key] || key));
        if (tab && tab.id !== "ocr" && tab.id !== "appearance") remountTabs.add(tab.id);
    }
    if (accessChanged) remountTabs.add("access");
    remountTabs.forEach(tab => { void remountOpenSettingTab(tab); });
    /// #else
    if (accessChanged) void remountOpenSettingTab("access");
    /// #endif
};

// 段读取只填写请求的配置段，其余字段为 null，不能用来覆盖本地已确认的配置。
const sectionConfig = (base: Config.IConf, section: SystemAppConf | null): SystemAppConf => {
    const merged: Record<string, unknown> = {...base};
    for (const [key, value] of Object.entries(section || {})) {
        if (value !== null && value !== undefined) {
            merged[key] = value;
        }
    }
    return merged as unknown as SystemAppConf;
};

const mergeFullConfig = async (response: IWebSocketData) => {
    if (response.code !== 0) {
        throw new Error(response.msg || "Could not refresh settings");
    }
    recordRevision("*", response.data.revision);
    syncSettingTasks(response.data.settingTasks);
    if (window.siyuan.config) {
        await applySettingConfig(systemConfig(response.data.conf), new Set(["*"]));
    }
};

const mergeSectionConfig = async (key: string, response: IWebSocketData) => {
    if (response.code !== 0) {
        throw new Error(response.msg || "Could not refresh settings");
    }
    recordRevision(key, response.data.revision);
    syncSettingTasks(response.data.settingTasks);
    if (!window.siyuan.config) {
        return;
    }
    await applySettingConfig(systemConfig(sectionConfig(window.siyuan.config, response.data.conf)), new Set([key]));
};

// 按待刷新集合读取，完整刷新与按段刷新共用同一套应用逻辑。
const drain = async () => {
    while (pending.size) {
        while (saving) await saved;
        const namespaces = pending;
        pending = new Map();
        // 多段同时待刷新时读取完整配置，避免逐段重复序列化整个配置。
        if (namespaces.has("*") || namespaces.size > 1) {
            await mergeFullConfig(await fetchSyncPost("/api/system/getConf", {}));
            continue;
        }
        const [[key, revision]] = namespaces;
        try {
            await mergeSectionConfig(key, await fetchSyncPost("/api/setting/getSection", {namespace: key}));
        } catch (error) {
            // 读取失败时保留该段，等下一次通知重试。
            queue(key, revision);
            throw error;
        }
    }
};

// 合并通知并串行读取，重连也使用同一流程，避免旧响应覆盖更新后的配置。
// 传 "*" 读取完整配置，其余命名空间只按段读取。
export const refreshSettingConfig = (namespace = "*", revision?: number): Promise<void> => {
    if (alreadyApplied(namespace, revision)) {
        return Promise.resolve();
    }
    queue(namespace, typeof revision === "number" ? revision : 0);
    if (refreshing) {
        return refreshing;
    }
    let failed = false;
    refreshing = drain().catch(error => {
        failed = true;
        throw error;
    }).finally(() => {
        refreshing = undefined;
        // 失败时保留待刷新集合，由后续通知重试，避免持续失败时反复请求。
        if (!failed && pending.size) return refreshSettingConfig();
    });
    void refreshing.catch(error => {
        // 读取失败时不保留序号，使后续通知可以重试。
        sectionRevisions.clear();
        console.error("Could not refresh settings", error);
    });
    return refreshing;
};
