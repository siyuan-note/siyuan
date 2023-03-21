
export const AI = {
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
</label>`;
    },
    bindEvent: () => {
    },
};
