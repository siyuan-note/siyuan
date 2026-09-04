import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {highlightRender} from "../protyle/render/highlightRender";
import {isMobile} from "../util/functions";
import {Constants} from "../constants";
import {sanitizeKernelHTML} from "../util/hostCapabilities";

export const openChangelog = (force = false) => {
    fetchPost("/api/system/getChangelog", {force}, (response) => {
        if (!response.data.show) {
            return;
        }
        const dialog = new Dialog({
            title: `✨ ${window.siyuan.languages.siyuanNote} v${response.data.version || window.siyuan.config.system.kernelVersion} ${window.siyuan.languages.changelog}`,
            width: isMobile() ? "92vw" : "768px",
            height: isMobile() ? "80vh" : "70vh",
            content: `<div style="overflow:auto;" class="b3-dialog__content b3-typography b3-typography--default">${sanitizeKernelHTML(response.data.html)}</div>`
        });
        dialog.element.setAttribute("data-key", Constants.DIALOG_CHANGELOG);
        highlightRender(dialog.element);
    });
};
