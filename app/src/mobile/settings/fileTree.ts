import {openModel} from "../menu/model";
import {fetchPost} from "../../util/fetch";
import {genNotebookOption} from "../../menus/onGetnotebookconf";

export const initFileTree = () => {
    openModel({
        title: window.siyuan.languages.editor,
        icon: "iconEdit",
        html: `<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.fileTree18}
        <div class="b3-label__text">${window.siyuan.languages.fileTree19}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="allowCreateDeeper" type="checkbox"${window.siyuan.config.fileTree.allowCreateDeeper ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.fileTree3}
        <div class="b3-label__text">${window.siyuan.languages.fileTree4}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="removeDocWithoutConfirm" type="checkbox"${window.siyuan.config.fileTree.removeDocWithoutConfirm ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.fileTree20}
        <div class="b3-label__text">${window.siyuan.languages.fileTree21}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="useSingleLineSave" type="checkbox"${window.siyuan.config.fileTree.useSingleLineSave ? " checked" : ""}/>
</label>
<div class="b3-label">
    ${window.siyuan.languages.fileTree16}
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="maxListCount" type="number" min="1" max="10240" value="${window.siyuan.config.fileTree.maxListCount}">
    <div class="b3-label__text">${window.siyuan.languages.fileTree17}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.fileTree12}
    <span class="fn__hr"></span>
    <select class="b3-select fn__block" id="docCreateSaveBox">${genNotebookOption(window.siyuan.config.fileTree.docCreateSaveBox)}</select>
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="docCreateSavePath" value="">
    <div class="b3-label__text">${window.siyuan.languages.fileTree13}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.fileTree5}
    <span class="fn__hr"></span>
    <select class="b3-select fn__block" id="refCreateSaveBox">${genNotebookOption(window.siyuan.config.fileTree.refCreateSaveBox)}</select>
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="refCreateSavePath" value="${window.siyuan.config.fileTree.refCreateSavePath}">
    <div class="b3-label__text">${window.siyuan.languages.fileTree6}</div>
</div>`,
        bindEvent(modelMainElement: HTMLElement) {
            (modelMainElement.querySelector("#docCreateSavePath") as HTMLInputElement).value = window.siyuan.config.fileTree.docCreateSavePath;
            (modelMainElement.querySelector("#refCreateSavePath") as HTMLInputElement).value = window.siyuan.config.fileTree.refCreateSavePath;
            modelMainElement.querySelectorAll("input, select").forEach((item) => {
                item.addEventListener("change", () => {
                    fetchPost("/api/setting/setFiletree", {
                        sort: window.siyuan.config.fileTree.sort,
                        alwaysSelectOpenedFile: window.siyuan.config.fileTree.alwaysSelectOpenedFile,
                        refCreateSavePath: (modelMainElement.querySelector("#refCreateSavePath") as HTMLInputElement).value,
                        refCreateSaveBox: (modelMainElement.querySelector("#refCreateSaveBox") as HTMLInputElement).value,
                        docCreateSavePath: (modelMainElement.querySelector("#docCreateSavePath") as HTMLInputElement).value,
                        docCreateSaveBox: (modelMainElement.querySelector("#docCreateSaveBox") as HTMLInputElement).value,
                        openFilesUseCurrentTab: window.siyuan.config.fileTree.openFilesUseCurrentTab,
                        closeTabsOnStart: window.siyuan.config.fileTree.closeTabsOnStart,
                        allowCreateDeeper: (modelMainElement.querySelector("#allowCreateDeeper") as HTMLInputElement).checked,
                        removeDocWithoutConfirm: (modelMainElement.querySelector("#removeDocWithoutConfirm") as HTMLInputElement).checked,
                        useSingleLineSave: (modelMainElement.querySelector("#useSingleLineSave") as HTMLInputElement).checked,
                        maxListCount: parseInt((modelMainElement.querySelector("#maxListCount") as HTMLInputElement).value),
                        maxOpenTabCount: window.siyuan.config.fileTree.maxOpenTabCount,
                    }, response => {
                        window.siyuan.config.fileTree = response.data;
                    });
                });
            });
        }
    });
};
