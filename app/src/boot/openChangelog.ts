import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {highlightRender} from "../protyle/render/highlightRender";
import {isMobile} from "../util/functions";

export const openChangelog = () => {
    fetchPost("/api/system/getChangelog", {}, (response) => {
        if (!response.data.show) {
            return;
        }
        const dialog = new Dialog({
            title: `✨ ${window.siyuan.languages.whatsNewInSiYuan} v${window.siyuan.config.system.kernelVersion}`,
            width: isMobile() ? "92vw" : "768px",
            height: isMobile() ? "80vh" : "70vh",
            content: `<div style="overflow:auto;" class="b3-dialog__content b3-typography b3-typography--default">${response.data.html}</div>`
        });
        highlightRender(dialog.element);
    });
};
