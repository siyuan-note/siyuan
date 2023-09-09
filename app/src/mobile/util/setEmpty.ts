import {mountHelp, newNotebook} from "../../util/mount";
import {newFile} from "../../util/newFile";
import {getOpenNotebookCount} from "../../util/pathName";
import {popSearch} from "../menu/search";
import {getRecentDocs} from "../menu/getRecentDocs";
import {openHistory} from "../../history/history";
import {App} from "../../index";

export const setEmpty = (app: App) => {
    document.getElementById("toolbarName").classList.add("fn__hidden");
    document.getElementById("editor").classList.add("fn__none");
    const emptyElement = document.getElementById("empty");
    emptyElement.classList.remove("fn__none");
    if (emptyElement.innerHTML !== "") {
        return;
    }
    emptyElement.innerHTML = `<div id="emptySearch" class="b3-list-item">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconSearch"></use></svg><span class="fn__space"></span><span class="b3-list-item__text">${window.siyuan.languages.search}</span>
</div>
<div id="emptyRecent" class="b3-list-item">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconList"></use></svg><span class="fn__space"></span><span class="b3-list-item__text">${window.siyuan.languages.recentDocs}</span>
</div>
<div id="emptyHistory" class="b3-list-item${window.siyuan.config.readonly ? " fn__none" : ""}">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconHistory"></use></svg><span class="fn__space"></span><span class="b3-list-item__text">${window.siyuan.languages.dataHistory}</span>
</div>
<div id="emptyNewFile" class="b3-list-item${(getOpenNotebookCount() > 0 || !window.siyuan.config.readonly) ? "" : " fn__none"}">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg><span class="fn__space"></span><span class="b3-list-item__text">${window.siyuan.languages.newFile}</span>
</div>
<div class="b3-list-item" id="emptyNewNotebook${window.siyuan.config.readonly ? " fn__none" : ""}">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconFilesRoot"></use></svg><span class="fn__space"></span><span class="b3-list-item__text">${window.siyuan.languages.newNotebook}</span>
</div>
<div class="b3-list-item" id="emptyHelp">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconHelp"></use></svg><span class="fn__space"></span><span class="b3-list-item__text">${window.siyuan.languages.help}</span>
</div>`;
    emptyElement.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(emptyElement)) {
            if (target.id === "emptySearch") {
                popSearch(app);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "emptyRecent") {
                getRecentDocs(app);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "emptyHistory") {
                openHistory(app);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "emptyNewFile") {
                if (window.siyuan.mobile.editor) {
                    newFile(app, window.siyuan.mobile.editor.protyle.notebookId, window.siyuan.mobile.editor.protyle.path, undefined, true);
                } else {
                    window.siyuan.notebooks.find(item => {
                        if (!item.closed) {
                            newFile(app, item.id, "/", undefined, true);
                            return true;
                        }
                    });
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "emptyNewNotebook") {
                newNotebook();
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "emptyHelp") {
                mountHelp();
                event.stopPropagation();
                event.preventDefault();
                break;
            }
            target = target.parentElement;
        }
    });
};

export const setEditor = () => {
    document.getElementById("toolbarName").classList.remove("fn__hidden");
    document.getElementById("editor").classList.remove("fn__none");
    document.getElementById("empty").classList.add("fn__none");
};
