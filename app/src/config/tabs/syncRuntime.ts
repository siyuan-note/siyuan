import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {processSync} from "../../dialog/processSystem";
import {updateAccountPanelVisibility} from "./accountUi";
import {showMessage} from "../../dialog/message";
import {
    refreshLANSyncConfigItemVisibility,
    refreshSyncModeRelatedItems,
    refreshSyncTabPanels,
} from "./syncUi";

/** 账号同步 Tab 根节点 */
export let syncTabElement: HTMLElement | undefined;

let syncAssetDownloadModePending = false;

/** 切换资源下载模式时显示进度，并阻止重复提交。 */
export const mountSyncAssetDownloadMode = (root: ParentNode) => {
    root.querySelectorAll<HTMLSelectElement>('[id="sync.assetDownloadMode"]').forEach((element) => {
        element.disabled = syncAssetDownloadModePending || window.siyuan.config.readonly;
        element.setAttribute("aria-busy", String(syncAssetDownloadModePending));
        if (!syncAssetDownloadModePending) {
            element.value = String(window.siyuan.config.sync.assetDownloadMode ?? 0);
        }
    });
    root.querySelectorAll<HTMLElement>('[data-type="syncAssetDownloadStatus"]').forEach((element) => {
        element.textContent = syncAssetDownloadModePending ? window.siyuan.languages.syncAssetDownloadModeUpdating : "";
    });
};

const setSyncAssetDownloadMode = async (mode: Config.ISync["assetDownloadMode"]) => {
    if (syncAssetDownloadModePending || (mode !== 0 && mode !== 1)) {
        mountSyncAssetDownloadMode(document);
        return;
    }
    syncAssetDownloadModePending = true;
    mountSyncAssetDownloadMode(document);
    try {
        const response = await fetchSyncPost("/api/sync/setSyncAssetDownloadMode", {mode});
        if (response.code === 0) {
            window.siyuan.config.sync.assetDownloadMode = response.data.assetDownloadMode;
        }
    } catch (error) {
        console.warn("[config] failed to update asset download mode", error);
        showMessage(window.siyuan.languages.syncAssetDownloadModeFailed, 5000, "error");
    } finally {
        syncAssetDownloadModePending = false;
        mountSyncAssetDownloadMode(document);
    }
};

/** 释放 Tab 根节点引用；传入 root 时仅释放对应挂载，避免影响其他设置入口 */
export const clearSyncTabElement = (root?: HTMLElement) => {
    if (!root || syncTabElement === root) {
        syncTabElement = undefined;
    }
};

/** 账号同步 Tab 挂载后的额外初始化（注册表 mount 之后调用） */
export const mountSyncTabExtras = (root: HTMLElement) => {
    syncTabElement = root;
    refreshSyncTabPanels(root);
    updateAccountPanelVisibility(root);
};

export const refreshLANSyncStatus = (root: Element) => {
    const statusElement = root.querySelector('[data-type="lanSyncStatus"]');
    if (!statusElement) {
        return;
    }
    if (!window.siyuan.config.sync.enabled) {
        statusElement.textContent = "";
        return;
    }
    fetchSyncPost("/api/sync/getSyncLANStatus", {}).then((response) => {
        if (!window.siyuan.config.sync.enabled) {
            statusElement.textContent = "";
            return;
        }
        if (response.code === 0 && response.data) {
            if (!response.data.active) {
                statusElement.textContent = window.siyuan.languages.lanSyncInactive;
                return;
            }
            const discovered = window.siyuan.languages.lanSyncDiscoveredPeers.replace(
                "${count}", String(response.data.discoveredPeers ?? 0));
            const connected = window.siyuan.languages.lanSyncConnectedPeers.replace(
                "${count}", String(response.data.connectedPeers ?? 0));
            statusElement.replaceChildren(discovered, document.createElement("br"), connected);
        }
    }).catch(() => {});
};

export const mountLANSyncStatus = (root: HTMLElement) => {
    const poll = () => {
        if (!root.isConnected) {
            return;
        }
        refreshLANSyncStatus(root);
        window.setTimeout(poll, 5000);
    };
    refreshLANSyncStatus(root);
    window.setTimeout(poll, 5000);
};

/** 切换同步提供商等场景：刷新云空间相关区块并重置云目录列表 */
export const refreshSyncCloudSpaceGroup = (root: Element) => {
    refreshSyncTabPanels(root);
    const syncConfigElement = root.querySelector("#syncCloudList");
    if (syncConfigElement) {
        syncConfigElement.innerHTML = "";
        syncConfigElement.classList.add("fn__none");
    }
};

/** 账号同步 Tab：按控件 id 提交配置并更新本地运行时 */
export const patchSyncConfig = (controlId: string, value: unknown) => {
    switch (controlId) {
        case "sync.provider": {
            const provider = value as Config.ISync["provider"];
            fetchPost("/api/sync/setSyncProvider", {provider}, () => {
                window.siyuan.config.sync.provider = provider;
                if (syncTabElement) {
                    refreshSyncCloudSpaceGroup(syncTabElement);
                }
            });
            break;
        }
        case "sync.enabled": {
            const enabled = Boolean(value) as Config.ISync["enabled"];
            fetchPost("/api/sync/setSyncEnable", {enabled}, () => {
                window.siyuan.config.sync.enabled = enabled;
                if (syncTabElement) {
                    refreshLANSyncConfigItemVisibility(syncTabElement);
                    refreshLANSyncStatus(syncTabElement);
                }
                processSync();
            });
            break;
        }
        case "sync.generateConflictDoc": {
            const generateConflictDoc = Boolean(value) as Config.ISync["generateConflictDoc"];
            fetchPost("/api/sync/setSyncGenerateConflictDoc", {enabled: generateConflictDoc}, () => {
                window.siyuan.config.sync.generateConflictDoc = generateConflictDoc;
            });
            break;
        }
        case "sync.mode": {
            const mode = value as Config.ISync["mode"];
            fetchPost("/api/sync/setSyncMode", {mode}, () => {
                window.siyuan.config.sync.mode = mode;
                if (syncTabElement) {
                    refreshSyncModeRelatedItems(syncTabElement);
                }
            });
            break;
        }
        case "sync.assetDownloadMode": {
            return setSyncAssetDownloadMode(value as Config.ISync["assetDownloadMode"]);
        }
        case "sync.interval": {
            const interval = value as Config.ISync["interval"];
            fetchPost("/api/sync/setSyncInterval", {interval}, () => {
                window.siyuan.config.sync.interval = interval;
                processSync();
            });
            break;
        }
        case "sync.perception": {
            const perception = Boolean(value) as Config.ISync["perception"];
            fetchPost("/api/sync/setSyncPerception", {enabled: perception}, () => {
                window.siyuan.config.sync.perception = perception;
                processSync();
            });
            break;
        }
        case "sync.lan.enabled": {
            const enabled = Boolean(value) as Config.ISyncLAN["enabled"];
            fetchPost("/api/sync/setSyncLAN", {
                enabled,
                maxConcurrentReqs: window.siyuan.config.sync.lan.maxConcurrentReqs,
            }, () => {
                window.siyuan.config.sync.lan.enabled = enabled;
                if (syncTabElement) {
                    refreshLANSyncStatus(syncTabElement);
                }
            });
            break;
        }

        case "repo.indexRetentionDays": {
            const indexRetentionDays = value as Config.IRepo["indexRetentionDays"];
            fetchPost("/api/repo/setRepoIndexRetentionDays", {days: indexRetentionDays}, () => {
                window.siyuan.config.repo.indexRetentionDays = indexRetentionDays;
            });
            break;
        }
        case "repo.retentionIndexesDaily": {
            const retentionIndexesDaily = value as Config.IRepo["retentionIndexesDaily"];
            fetchPost("/api/repo/setRetentionIndexesDaily", {indexes: retentionIndexesDaily}, () => {
                window.siyuan.config.repo.retentionIndexesDaily = retentionIndexesDaily;
            });
            break;
        }
        default:
            console.warn(`[config] patchSyncConfig: unhandled controlId "${controlId}"`);
            break;
    }
};
