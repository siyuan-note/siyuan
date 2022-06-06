import {hideMessage, showMessage} from "../../dialog/message";
/// #if !BROWSER
import {escapeHtml} from "../../util/escape";
import {shell} from "electron";
import * as path from "path";

export const afterExport = (exportPath: string, msgId: string) => {
    showMessage(`${window.siyuan.languages.exported}${escapeHtml(exportPath)}
<div class="fn__space"></div>
<button class="b3-button b3-button--white">${window.siyuan.languages.showInFolder}</button>`, 6000, "info", msgId);
    document.querySelector(`#message [data-id="${msgId}"] button`).addEventListener("click", () => {
        shell.showItemInFolder(path.join(exportPath));
        hideMessage(msgId);
    });
};
/// #endif
