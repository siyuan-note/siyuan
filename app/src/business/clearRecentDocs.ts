import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
import {fetchSyncPost} from "../util/fetch";
import {escapeHtmlTextAndAttr} from "../util/escape";

export const clearRecentDocsButtonHTML = () => `<button type="button" data-action="clear-recent-docs" class="block__icon block__icon--show fn__none b3-tooltips b3-tooltips__sw" aria-label="${escapeHtmlTextAndAttr(window.siyuan.languages.clearRecentDocs)}"><svg><use xlink:href="#iconTrashcan"></use></svg></button>`;

export const bindClearRecentDocs = (button: HTMLButtonElement, getSortBy: () => string,
                                   isActive: () => boolean, onCleared: () => void) => {
    let pending = false;
    const canWrite = () => !window.siyuan.config.readonly && !window.siyuan.isPublish;
    const update = () => {
        button.classList.toggle("fn__none", !canWrite() || ["created", "updated"].includes(getSortBy()));
        button.disabled = pending;
    };
    button.addEventListener("click", () => {
        if (pending || !canWrite() || !isActive() || ["created", "updated"].includes(getSortBy())) {
            return;
        }
        pending = true;
        update();
        const finish = () => {
            pending = false;
            update();
        };
        confirmDialog(window.siyuan.languages.clearRecentDocs, window.siyuan.languages.confirmClearRecentDocs, async () => {
            try {
                if (!canWrite() || !isActive()) {
                    return;
                }
                const response = await fetchSyncPost("/api/storage/clearRecentDocs", {});
                if (response.code === 0 && isActive()) {
                    onCleared();
                }
            } catch (error) {
                showMessage(error.message, 0, "error");
            } finally {
                finish();
            }
        }, finish);
    });
    update();
    return update;
};
