import {showMessage} from "../../dialog/message";
import {resetMobileLayoutScroll, resumeMobileScrollSaving, saveMobileLayout} from "./saveLayout";

let reloading = false;

export const reloadMobileUI = async (resetScroll = false): Promise<void> => {
    if (reloading) return;
    reloading = true;
    let reloaded = false;
    try {
        if (!await saveMobileLayout() || (resetScroll && !await resetMobileLayoutScroll())) {
            showMessage(window.siyuan.languages.mobileLayoutSaveError, 6000, "error");
            return;
        }
        window.location.reload();
        reloaded = true;
    } catch (error) {
        resumeMobileScrollSaving();
        console.warn("Could not reload the mobile interface", error);
        showMessage(window.siyuan.languages.mobileLayoutSaveError, 6000, "error");
    } finally {
        if (!reloaded) reloading = false;
    }
};
