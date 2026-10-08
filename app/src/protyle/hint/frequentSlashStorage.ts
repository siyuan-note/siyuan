import {SLASH_MENU_FREQUENT_PATH, SLASH_MENU_ROOT_PATH} from "../../config/entryVisibility/catalog";
import {getConfiguredEntryVisibility} from "../../config/entryVisibility/runtime";
import {Constants} from "../../constants";
import {trackSettingSave} from "../../config/setting/pending";
import {setStorageVal} from "../util/compatibility";
import {normalizeSlashUsage, rankFrequentSlashItems} from "./frequentSlash";

export const isFrequentSlashEnabled = () =>
    getConfiguredEntryVisibility(SLASH_MENU_FREQUENT_PATH, SLASH_MENU_ROOT_PATH);

const writable = () => window.siyuan.storage && !window.siyuan.config.readonly && !window.siyuan.isPublish;

const pending = new Map<string, unknown>();
let saving = false;

// 同一窗口的快速操作合并并按顺序保存，避免较早的请求覆盖新次数。
const persist = (key: string, value: unknown) => {
    pending.set(key, value);
    if (saving) {
        return;
    }
    saving = true;
    void trackSettingSave((async () => {
        try {
            while (pending.size > 0) {
                const [nextKey, nextValue] = pending.entries().next().value as [string, unknown];
                pending.delete(nextKey);
                try {
                    await setStorageVal(nextKey, nextValue);
                } catch (_error) {
                    // 保留内存状态，下一次操作继续保存；统计失败不阻止编辑。
                }
            }
        } finally {
            saving = false;
        }
    })());
};

export const getFrequentSlashItems = <T>(items: T[], getKey: (item: T) => string): T[] =>
    isFrequentSlashEnabled() ? rankFrequentSlashItems(items, getKey,
        normalizeSlashUsage(window.siyuan.storage?.[Constants.LOCAL_SLASH_USAGE])) : [];

export const recordSlashExecution = (entryKey: string) => {
    if (!entryKey || entryKey.length > 1024 || !writable() || !isFrequentSlashEnabled()) {
        return;
    }
    const usage = normalizeSlashUsage(window.siyuan.storage[Constants.LOCAL_SLASH_USAGE]);
    const count = Object.prototype.hasOwnProperty.call(usage, entryKey) ? usage[entryKey] : 0;
    Object.defineProperty(usage, entryKey, {value: Math.min(count + 1, Number.MAX_SAFE_INTEGER),
        enumerable: true, configurable: true, writable: true});
    window.siyuan.storage[Constants.LOCAL_SLASH_USAGE] = usage;
    void persist(Constants.LOCAL_SLASH_USAGE, usage);
};
