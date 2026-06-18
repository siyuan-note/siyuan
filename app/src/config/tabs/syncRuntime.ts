import {fetchPost} from "../../util/fetch";
import {processSync} from "../../dialog/processSystem";
import {
    onSetaccount,
    updateAccountSwitchesVisibility,
} from "./accountUi";
import {
    refreshSyncModeRelatedItems,
    refreshSyncTabPanels,
} from "./syncUi";

/** 账号同步 Tab 根节点 */
export let syncTabElement: HTMLElement | undefined;

/** 设置对话框关闭后释放 Tab 根节点引用，避免持有已脱离文档的 DOM */
export const clearSyncTabElement = () => {
    syncTabElement = undefined;
};

/** 账号同步 Tab 挂载后的额外初始化（注册表 mount 之后调用） */
export const mountSyncTabExtras = (root: HTMLElement) => {
    syncTabElement = root;
    refreshSyncTabPanels(root);
    updateAccountSwitchesVisibility(root);
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
        case "account.displayTitle": {
            const displayTitle = Boolean(value) as Config.IAccount["displayTitle"];
            fetchPost("/api/setting/setAccount", {
                ...window.siyuan.config.account,
                displayTitle,
            }, (response) => {
                window.siyuan.config.account = response.data;
                onSetaccount();
            });
            break;
        }
        case "account.displayVIP": {
            const displayVIP = Boolean(value) as Config.IAccount["displayVIP"];
            fetchPost("/api/setting/setAccount", {
                ...window.siyuan.config.account,
                displayVIP,
            }, (response) => {
                window.siyuan.config.account = response.data;
                onSetaccount();
            });
            break;
        }

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
