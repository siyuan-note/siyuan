import {Constants} from "../../constants";
import {saveScroll} from "../../protyle/scroll/saveScroll";
import {setStorageVal} from "../../protyle/util/compatibility";
import {isEncryptedBox} from "../../util/pathName";
import {withFetchTimeout} from "../../util/fetchTimeout";

const pendingWrites = new Map<string, Promise<boolean>>();
let resettingScroll = false;

export const resumeMobileScrollSaving = () => {
    resettingScroll = false;
};

export const saveMobileStorage = (key: string, value: unknown): Promise<boolean> => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return Promise.resolve(true);
    }
    // 排队前复制快照，避免页签切换和历史记录修改影响尚未写入的内容。
    const snapshot = resettingScroll && key === Constants.LOCAL_FILEPOSITION ? {} : JSON.parse(JSON.stringify(value));
    if (resettingScroll && key === Constants.LOCAL_MOBILE_TABS) {
        for (const tab of snapshot?.tabs || []) {
            for (const entry of [tab.current, ...(tab.backStack || []), ...(tab.forwardStack || [])]) {
                if (entry) delete entry.scroll;
            }
        }
    }
    const write = async () => {
        let saved = false;
        try {
            await setStorageVal(key, snapshot, () => { saved = true; }, 10000);
        } catch (error) {
            console.warn("Save mobile layout failed", error);
            return false;
        }
        return saved;
    };
    if (key !== Constants.LOCAL_MOBILE_TABS && key !== Constants.LOCAL_FILEPOSITION) {
        return write();
    }
    const pending = pendingWrites.get(key);
    const result = pending ? pending.then(write) : write();
    pendingWrites.set(key, result);
    void result.then(() => {
        if (pendingWrites.get(key) === result) {
            pendingWrites.delete(key);
        }
    });
    return result;
};

export const resetMobileLayoutScroll = async (): Promise<boolean> => {
    // 重载前的生命周期保存仍可能捕获旧编辑器，所有后续写入都要过滤其阅读位置。
    resettingScroll = true;
    try {
        const saved = await withFetchTimeout(async () => {
            const results = await Promise.all([
                saveMobileLayout(),
                saveMobileStorage(Constants.LOCAL_FILEPOSITION, {}),
            ]);
            return results.every(Boolean);
        }, undefined, 10000);
        if (!saved) resettingScroll = false;
        else window.siyuan.storage[Constants.LOCAL_FILEPOSITION] = {};
        return saved;
    } catch (error) {
        resettingScroll = false;
        console.warn("Reset mobile reading positions failed", error);
        return false;
    }
};

const saveLayout = async (): Promise<boolean> => {
    if (window.siyuan.mobile.tabs) {
        return window.siyuan.mobile.tabs.save();
    }
    const protyle = window.siyuan.mobile.editor?.protyle;
    if (!protyle) {
        return true;
    }
    const scroll = saveScroll(protyle, true) as IScrollAttr | undefined;
    if (!scroll) {
        return true;
    }
    const positions = window.siyuan.storage[Constants.LOCAL_FILEPOSITION];
    if (isEncryptedBox(protyle.notebookId)) {
        delete positions[protyle.block.rootID];
    } else {
        positions[protyle.block.rootID] = scroll;
    }
    return saveMobileStorage(Constants.LOCAL_FILEPOSITION, positions);
};

export const saveMobileLayout = (): Promise<boolean> => {
    // 限制整个保存流程的等待时间，退出和锁屏不逐个等待积压的请求超时。
    const saved = saveLayout();
    return withFetchTimeout(() => saved, undefined, 10000).catch((error) => {
        console.warn("Save mobile layout failed", error);
        return false;
    });
};
