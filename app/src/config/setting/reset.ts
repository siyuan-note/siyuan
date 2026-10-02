import {confirmDialog} from "../../dialog/confirmDialog";
import {fetchSyncPost} from "../../util/fetch";
import {getAllEditor} from "../../layout/getAll";
import {setNativeSettingTask} from "./taskBlocker";
import {flushSettingSaves, settingSaveFailures} from "./pending";
import {getHostCapabilities} from "../../util/hostCapabilities";
import {showMessage} from "../../dialog/message";
/// #if !MOBILE
import {suspendLayoutSaving} from "../../layout/util";
/// #endif
/// #if !BROWSER
import {isWindow} from "../../util/functions";
import {isSettingsWindow} from "./windowContext";
import {exitSiYuan} from "../../dialog/processSystem";
/// #endif

const EXIT_AFTER_RESET = "siyuan-exit-after-settings-reset";
let preparation: {id: string; resume?: () => void; timer: number; saved?: boolean};

export const cancelSettingsReset = (id: string) => {
    if (preparation?.id !== id) return;
    window.clearTimeout(preparation.timer);
    preparation.resume?.();
    preparation = undefined;
    setNativeSettingTask("native-reset-" + id, false);
};

// 每个客户端先提交输入并暂停布局保存；任一准备失败时内核取消整个重置。
export const prepareSettingsReset = async (data: {id: string; token: string}) => {
    if (preparation) return;
    preparation = {id: data.id, timer: window.setTimeout(() => cancelSettingsReset(data.id), 20000)};
    setNativeSettingTask("native-reset-" + data.id, true);
    let saved = false;
    const previousFailures = settingSaveFailures();
    try {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        await Promise.all(getAllEditor().filter(editor => editor?.protyle?.wysiwyg)
            .map(editor => editor.flushPendingTransactions()));
        /// #if !MOBILE
        const resume = await suspendLayoutSaving();
        if (preparation?.id !== data.id) {
            resume();
            return;
        }
        preparation.resume = resume;
        /// #endif
        await flushSettingSaves(previousFailures);
        if (preparation?.id !== data.id) return;
        saved = true;
        preparation.saved = true;
    } catch (error) {
        console.error("Could not prepare settings reset", error);
    }
    try {
        const response = await fetchSyncPost("/api/setting/confirmSettingsReset", {token: data.token, saved}, undefined, false);
        if (response.code !== 0) {
            cancelSettingsReset(data.id);
        } else if (preparation?.id === data.id) {
            window.clearTimeout(preparation.timer);
        }
    } catch (error) {
        console.error(error);
        cancelSettingsReset(data.id);
    }
};

// 已保存内容的客户端重连时重新读取配置，避免错过完成通知后继续写回旧偏好。
export const reloadSettingsResetOnReconnect = () => {
    if (!preparation) return false;
    if (!preparation.saved) {
        cancelSettingsReset(preparation.id);
        return false;
    }
    window.location.reload();
    return true;
};

export const completeSettingsReset = (data: {id: string; exit: boolean}) => {
    if (preparation) window.clearTimeout(preparation.timer);
    /// #if !BROWSER
    if (data.exit && getHostCapabilities().ownsKernel && !isWindow() && !isSettingsWindow()) {
        sessionStorage.setItem(EXIT_AFTER_RESET, "true");
    }
    /// #endif
    // 直接重载，不能走保存旧布局的普通 reloadui 流程。
    window.location.reload();
};

export const exitAfterSettingsReset = () => {
    /// #if !BROWSER
    if (sessionStorage.getItem(EXIT_AFTER_RESET)) {
        sessionStorage.removeItem(EXIT_AFTER_RESET);
        if (getHostCapabilities().ownsKernel) void exitSiYuan();
    }
    /// #endif
};

export const confirmResetSettings = () => {
    let exit = false;
    /// #if !BROWSER
    exit = getHostCapabilities().ownsKernel;
    /// #endif
    confirmDialog(window.siyuan.languages.resetSettings,
        window.siyuan.languages.resetSettingsConfirm + "<br><br>" +
        window.siyuan.languages[exit ? "resetSettingsExit" : "resetSettingsReload"], async () => {
            try {
                const response = await fetchSyncPost("/api/setting/resetSettings", {exit});
                if (response.code !== 0) return;
            } catch (error) {
                console.error(error);
                showMessage(window.siyuan.languages.settingsPendingSaveError, 6000, "error");
            }
        });
};
