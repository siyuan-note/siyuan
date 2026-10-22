import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
import {fetchSyncPost} from "../util/fetch";
import {escapeHtmlTextAndAttr} from "../util/escape";

const clearRecentDocsIconHTML = '<svg><use xlink:href="#iconTrashcan"></use></svg>';

/** 移动端工具栏使用的图标按钮，悬浮提示由 aria-label 提供 */
export const clearRecentDocsButtonHTML = () => `<button type="button" data-action="clear-recent-docs" class="block__icon block__icon--show fn__none b3-tooltips b3-tooltips__sw" aria-label="${escapeHtmlTextAndAttr(window.siyuan.languages.clearRecentDocs)}">${clearRecentDocsIconHTML}</button>`;

/** 最近文档对话框底部使用的文字按钮，使用中性色避免抢夺列表内容的注意力 */
export const clearRecentDocsTextButtonHTML = () => `<button type="button" data-action="clear-recent-docs" class="b3-button b3-button--cancel fn__none">${clearRecentDocsIconHTML}${escapeHtmlTextAndAttr(window.siyuan.languages.clear)}</button>`;

export const bindClearRecentDocs = (button: HTMLButtonElement, getSortBy: () => string,
                                   isActive: () => boolean, onCleared: () => void) => {
    let pending = false;
    const canWrite = () => !window.siyuan.config.readonly && !window.siyuan.isPublish;
    // 最近创建、最近修改来自块数据查询，清空本地浏览记录不会改变这两类列表
    const isSortClearable = () => !["created", "updated"].includes(getSortBy());
    const update = () => {
        // 无写权限时完全隐藏；当前排序不可清空时保留占位并禁用，避免切换排序推挤相邻控件
        button.classList.toggle("fn__none", !canWrite());
        button.disabled = pending || !isSortClearable();
    };
    button.addEventListener("click", () => {
        if (pending || !canWrite() || !isActive() || !isSortClearable()) {
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
