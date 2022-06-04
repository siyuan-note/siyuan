import {hideMessage, showMessage} from "../../dialog/message";
/// #if !BROWSER
import {escapeHtml} from "../../util/escape";
import {shell} from "electron";
import * as path from "path";

export const afterExport = (exportPath: string) => {
    const id = showMessage(`<div class="fn__flex">
    <div class="fn__flex-center">${window.siyuan.languages.exported}${escapeHtml(exportPath)}</div> 
    <div class="fn__space"></div>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--white">${window.siyuan.languages.showInFolder}</button>
</div>`, 6000);
    document.querySelector("#message button").addEventListener("click", () => {
        shell.showItemInFolder(path.join(exportPath));
        hideMessage(id);
    });
};
/// #endif
