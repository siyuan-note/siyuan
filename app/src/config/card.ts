import {fetchPost} from "../util/fetch";

export const card = {
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
        card.element.querySelectorAll("input").forEach((item) => {
            item.addEventListener("change", () => {
                fetchPost("/api/setting/setFlashcard", {
                        apiBaseURL: (card.element.querySelector("#apiBaseURL") as HTMLInputElement).checked,
                        apiKey: (card.element.querySelector("#apiKey") as HTMLInputElement).value,
                        apiMaxTokens: (card.element.querySelector("#apiMaxTokens") as HTMLInputElement).value,
                        apiProxy: (card.element.querySelector("#apiProxy") as HTMLInputElement).checked,
                        apiTimeout: (card.element.querySelector("#apiTimeout") as HTMLInputElement).checked,
                }, response => {
                    window.siyuan.config.ai = response.data;
                });
            });
        });
    },
};
