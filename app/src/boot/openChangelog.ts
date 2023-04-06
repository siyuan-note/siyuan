import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {highlightRender} from "../protyle/markdown/highlightRender";
import {isMobile} from "../util/functions";

export const openChangelog = () => {
    fetchPost("/api/system/getChangelog", {}, (response) => {
        if (!response.data.show) {
            return;
        }
        const dialog = new Dialog({
            title: `✨ ${window.siyuan.languages.changelog}`,
            width: isMobile() ? "90vw" : "768px",
            content: `<div style="overflow:auto;height: ${isMobile() ? "80" : "70"}vh;" class="b3-dialog__content b3-typography b3-typography--default">${response.data.html}</div>`
        });
        highlightRender(dialog.element);
    });
};
