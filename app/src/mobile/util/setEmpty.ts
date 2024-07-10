import {mountHelp, newNotebook} from "../../util/mount";
import {newFile} from "../../util/newFile";
import {getOpenNotebookCount} from "../../util/pathName";
import {popSearch} from "../menu/search";
import {getRecentDocs} from "../menu/getRecentDocs";
import {openHistory} from "../../history/history";
import {App} from "../../index";
import {setTitle} from "../../dialog/processSystem";
import {isIPhone} from "../../protyle/util/compatibility";

export const setEmpty = (app: App) => {
    setTitle(window.siyuan.languages.siyuanNote);
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
<div class="b3-list-item${(isIPhone() || window.siyuan.config.readonly) ? " fn__none" : ""}" id="emptyHelp">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconHelp"></use></svg><span class="fn__space"></span><span class="b3-list-item__text">${window.siyuan.languages.userGuide}</span>
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
                newFile({
                    app,
                    useSavePath: true
                });
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
    const toolbarNameElement = document.getElementById("toolbarName") as HTMLInputElement;
    setTitle(toolbarNameElement.value);
    toolbarNameElement.classList.remove("fn__hidden");
    document.getElementById("editor").classList.remove("fn__none");
    document.getElementById("empty").classList.add("fn__none");
};
