import {fetchPost} from "../util/fetch";

export const fileTree = {
    element: undefined as Element,
    genHTML: () => {
        return `<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.selectOpen}
        <div class="b3-label__text">${window.siyuan.languages.fileTree2}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="alwaysSelectOpenedFile" type="checkbox"${window.siyuan.config.fileTree.alwaysSelectOpenedFile ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.fileTree7}
        <div class="b3-label__text">${window.siyuan.languages.fileTree8}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="openFilesUseCurrentTab" type="checkbox"${window.siyuan.config.fileTree.openFilesUseCurrentTab ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.fileTree9}
        <div class="b3-label__text">${window.siyuan.languages.fileTree10}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="closeTabsOnStart" type="checkbox"${window.siyuan.config.fileTree.closeTabsOnStart ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
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
        ${window.siyuan.languages.fileTree12}
        <div class="b3-label__text b3-typography">${window.siyuan.languages.fileTree13}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="createDocNameTemplate" value="">
</label>
<label class="b3-label fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.fileTree5}
        <div class="b3-label__text b3-typography">${window.siyuan.languages.fileTree6}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="refCreateSavePath" value="${window.siyuan.config.fileTree.refCreateSavePath}">
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.fileTree16}
        <div class="b3-label__text">${window.siyuan.languages.fileTree17}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="maxListCount" type="number" min="1" max="10240" value="${window.siyuan.config.fileTree.maxListCount}">
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.tabLimit}
        <div class="b3-label__text">${window.siyuan.languages.tabLimit1}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="maxOpenTabCount" type="number" min="1" max="32" value="${window.siyuan.config.fileTree.maxOpenTabCount}">
</label>`;
    },
    _send() {
        fetchPost("/api/setting/setFiletree", {
            sort: window.siyuan.config.fileTree.sort,
            alwaysSelectOpenedFile: (fileTree.element.querySelector("#alwaysSelectOpenedFile") as HTMLInputElement).checked,
            refCreateSavePath: (fileTree.element.querySelector("#refCreateSavePath") as HTMLInputElement).value,
            createDocNameTemplate: (fileTree.element.querySelector("#createDocNameTemplate") as HTMLInputElement).value,
            openFilesUseCurrentTab: (fileTree.element.querySelector("#openFilesUseCurrentTab") as HTMLInputElement).checked,
            closeTabsOnStart: (fileTree.element.querySelector("#closeTabsOnStart") as HTMLInputElement).checked,
            allowCreateDeeper: (fileTree.element.querySelector("#allowCreateDeeper") as HTMLInputElement).checked,
            removeDocWithoutConfirm: (fileTree.element.querySelector("#removeDocWithoutConfirm") as HTMLInputElement).checked,
            maxListCount: parseInt((fileTree.element.querySelector("#maxListCount") as HTMLInputElement).value),
            maxOpenTabCount: parseInt((fileTree.element.querySelector("#maxOpenTabCount") as HTMLInputElement).value),
        }, response => {
            fileTree.onSetfiletree(response.data);
        });
    },
    bindEvent: () => {
        (fileTree.element.querySelector("#createDocNameTemplate") as HTMLInputElement).value = window.siyuan.config.fileTree.createDocNameTemplate;
        (fileTree.element.querySelector("#refCreateSavePath") as HTMLInputElement).value = window.siyuan.config.fileTree.refCreateSavePath;
        fileTree.element.querySelectorAll("input").forEach((item) => {
            item.addEventListener("change", () => {
                fileTree._send();
            });
        });
    },
    onSetfiletree: (fileTree: IFileTree) => {
        window.siyuan.config.fileTree = fileTree;
    }
};
