import {Constants} from "../../constants";
import {saveScroll} from "../../protyle/scroll/saveScroll";
import {setStorageVal} from "../../protyle/util/compatibility";
import {isEncryptedBox} from "../../util/pathName";
import {withFetchTimeout} from "../../util/fetchTimeout";

const pendingWrites = new Map<string, Promise<boolean>>();

export const saveMobileStorage = (key: string, value: unknown): Promise<boolean> => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return Promise.resolve(true);
    }
    // 排队前复制快照，避免页签切换和历史记录修改影响尚未写入的内容。
    const snapshot = JSON.parse(JSON.stringify(value));
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
    if (key !== Constants.LOCAL_MOBILE_TABS) {
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
