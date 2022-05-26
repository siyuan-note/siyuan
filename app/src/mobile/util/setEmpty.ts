import {getEventName} from "../../protyle/util/compatibility";
import {mountHelp, newNotebook} from "../../util/mount";
import {newFile} from "../../util/newFile";
import {getOpenNotebookCount} from "../../util/pathName";

export const setEmpty = () => {
    document.getElementById("toolbarName").classList.add("fn__hidden");
    document.getElementById("toolbarEdit").classList.add("fn__hidden");
    document.getElementById("editor").classList.add("fn__none");
    const emptyElement = document.getElementById("empty");
    emptyElement.innerHTML = `<h1 style="width: 200px">${window.siyuan.languages.noOpenFile}</h1>
<div class="fn__hr--b"></div>
<div id="emptyNewFile" class="b3-list-item b3-list-item--big${getOpenNotebookCount() > 0 ? "" :" fn__none"}">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.newFile}</span>
</div>
<div class="b3-list-item b3-list-item--big" id="emptyNewNotebook">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconFilesRoot"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.newNotebook}</span>
</div>
<div class="b3-list-item b3-list-item--big" id="emptyHelp">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconHelp"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.help}</span>
</div>`;
    document.getElementById("emptyNewFile").addEventListener(getEventName(), () => {
        if (window.siyuan.mobileEditor) {
            newFile(window.siyuan.mobileEditor.protyle.notebookId, window.siyuan.mobileEditor.protyle.path, true);
        } else {
            window.siyuan.notebooks.find(item => {
                if (item.closed) {
                    newFile(item.id, "/", true);
                }
            });
        }
    });
    document.getElementById("emptyNewNotebook").addEventListener(getEventName(), () => {
        newNotebook();
    });
    document.getElementById("emptyHelp").addEventListener(getEventName(), () => {
        mountHelp();
    });
    emptyElement.classList.remove("fn__none");
};

export const setEditor = () => {
    document.getElementById("toolbarName").classList.remove("fn__hidden");
    document.getElementById("toolbarEdit").classList.remove("fn__hidden");
    document.getElementById("editor").classList.remove("fn__none");
    document.getElementById("empty").classList.add("fn__none");
};
