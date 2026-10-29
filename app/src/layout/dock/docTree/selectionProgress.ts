import {hideMessage, showMessage} from "../../../dialog/message";
import {escapeHtml} from "../../../util/escape";
import {genUUID} from "../../../util/genID";

// 范围选择需要跨批读取时提供进度和取消入口，快速选择不显示通知。
export const createDocTreeSelectionProgress = () => {
    const id = `doc-tree-selection-${genUUID()}`;
    let timer: number;
    let visible = false;
    let state: {loaded: number, total: number, cancel: () => void};
    const destroy = () => {
        window.clearTimeout(timer);
        timer = undefined;
        state = undefined;
        if (visible) {
            hideMessage(id);
            visible = false;
        }
    };
    const render = () => {
        if (!state) { return; }
        visible = true;
        showMessage(`<span role="status">${escapeHtml(window.siyuan.languages.loading)} ${state.loaded}/${state.total}</span>
<span class="fn__space"></span><button class="b3-button b3-button--outline" data-doc-tree-cancel="true">${escapeHtml(window.siyuan.languages.cancel)}</button>`, -1, "info", id);
        document.querySelector(`[data-id="${id}"] [data-doc-tree-cancel]`)?.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            state?.cancel();
            destroy();
        }, {once: true});
    };
    return {
        update(loaded: number, total: number, cancel: () => void) {
            if (total <= 0 || loaded >= total) { destroy(); return; }
            state = {loaded, total, cancel};
            if (visible) { render(); }
            else if (timer === undefined) {
                timer = window.setTimeout(() => { timer = undefined; render(); }, 200);
            }
        },
        destroy,
    };
};
