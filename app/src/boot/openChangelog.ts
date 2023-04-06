import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {highlightRender} from "../protyle/markdown/highlightRender";
import {isMobile} from "../util/functions";
import {Constants} from "../constants";

export const openChangelog = () => {
    fetchPost("/api/system/getChangelog", {}, (response) => {
        if (!response.data.show) {
            return;
        }
        const dialog = new Dialog({
            title: `v${Constants.SIYUAN_VERSION} ${window.siyuan.languages.update}`,
            width: isMobile() ? "80vw" : "520px",
            content: `<div class="b3-dialog__content b3-typography b3-typography--default">${response.data.html}</div>`
        });
        highlightRender(dialog.element);
    });
}
