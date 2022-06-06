import {fetchPost} from "../util/fetch";
/// #if !BROWSER
import {dialog} from "@electron/remote";
import {SaveDialogReturnValue, shell} from "electron";
import {afterExport} from "../protyle/export/util";
/// #endif
import {isBrowser} from "../util/functions";
import {hideMessage, showMessage} from "../dialog/message";

export const exportConfig = {
    element: undefined as Element,
    genHTML: () => {
        return `<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.paragraphBeginningSpace}
        <div class="b3-label__text">${window.siyuan.languages.md4}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="paragraphBeginningSpace" type="checkbox"${window.siyuan.config.export.paragraphBeginningSpace ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.export17}
        <div class="b3-label__text">${window.siyuan.languages.export18}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="addTitle" type="checkbox"${window.siyuan.config.export.addTitle ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.blockRef}
        <div class="b3-label__text">${window.siyuan.languages.export11}</div>
    </div>
    <span class="fn__space"></span>
    <select id="blockRefMode" class="b3-select fn__flex-center fn__size200">
        <option value="2" ${window.siyuan.config.export.blockRefMode === 2 ? "selected" : ""}>${window.siyuan.languages.export2}</option>
        <option value="3" ${window.siyuan.config.export.blockRefMode === 3 ? "selected" : ""}>${window.siyuan.languages.export3}</option>
        <option value="4" ${window.siyuan.config.export.blockRefMode === 4 ? "selected" : ""}>${window.siyuan.languages.export4}</option>
    </select>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.blockEmbed}
        <div class="b3-label__text">${window.siyuan.languages.export12}</div>
    </div>
    <span class="fn__space"></span>
    <select id="blockEmbedMode" class="b3-select fn__flex-center fn__size200">
        <option value="0" ${window.siyuan.config.export.blockEmbedMode === 0 ? "selected" : ""}>${window.siyuan.languages.export0}</option>
        <option value="1" ${window.siyuan.config.export.blockEmbedMode === 1 ? "selected" : ""}>${window.siyuan.languages.export1}</option>
    </select>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.export5}
        <div class="b3-label__text">${window.siyuan.languages.export6}</div>
    </div>
    <span class="fn__space"></span>
    <select id="fileAnnotationRefMode" class="b3-select fn__flex-center fn__size200">
        <option value="0" ${window.siyuan.config.export.fileAnnotationRefMode === 0 ? "selected" : ""}>${window.siyuan.languages.export7}</option>
        <option value="1" ${window.siyuan.config.export.fileAnnotationRefMode === 1 ? "selected" : ""}>${window.siyuan.languages.export8}</option>
    </select>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.export13}
        <div class="b3-label__text">${window.siyuan.languages.export14}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center" id="blockRefTextLeft" style="width: 96px">
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center" id="blockRefTextRight" style="width: 96px">
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.export15}
        <div class="b3-label__text">${window.siyuan.languages.export16}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center" id="tagOpenMarker" style="width: 96px">
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center" id="tagCloseMarker" style="width: 96px">
</label>
<label class="fn__flex b3-label${isBrowser() ? " fn__none" : ""}">
    <div class="fn__flex-1">
        ${window.siyuan.languages.export19}
        <span class="fn__space"></span>
        <a href="javascript:void(0)" id="pandocBinPath">${window.siyuan.config.export.pandocBin}</a>
        <div class="b3-label__text">${window.siyuan.languages.export20}</div>
    </div>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="pandocBin"><svg><use xlink:href="#iconSettings"></use></svg>${window.siyuan.languages.config}</button>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1 fn__flex-center">
        ${window.siyuan.languages.export} Data
        <div class="b3-label__text b3-typography">${window.siyuan.languages.exportDataTip}</div>
    </div>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="exportData"><svg><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.export}</button>
</label>
<div class="fn__flex b3-label">
    <div class="fn__flex-1 fn__flex-center">
        ${window.siyuan.languages.import} Data
        <div class="b3-label__text b3-typography">${window.siyuan.languages.importDataTip}</div>
    </div>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" style="position: relative">
        <input id="importData" class="b3-form__upload" type="file">
        <svg><use xlink:href="#iconDownload"></use></svg>${window.siyuan.languages.import}
    </button>
</div>`;
    },
    bindEvent: () => {
        (exportConfig.element.querySelector("#blockRefTextLeft") as HTMLInputElement).value = window.siyuan.config.export.blockRefTextLeft;
        (exportConfig.element.querySelector("#blockRefTextRight") as HTMLInputElement).value = window.siyuan.config.export.blockRefTextRight;
        (exportConfig.element.querySelector("#tagOpenMarker") as HTMLInputElement).value = window.siyuan.config.export.tagOpenMarker;
        (exportConfig.element.querySelector("#tagCloseMarker") as HTMLInputElement).value = window.siyuan.config.export.tagCloseMarker;
        const pandocBinPathElement = exportConfig.element.querySelector("#pandocBinPath");
        const setexprt = (pandocBin?: string) => {
            fetchPost("/api/setting/setExport", {
                paragraphBeginningSpace: (exportConfig.element.querySelector("#paragraphBeginningSpace") as HTMLInputElement).checked,
                addTitle: (exportConfig.element.querySelector("#addTitle") as HTMLInputElement).checked,
                blockRefMode: parseInt((exportConfig.element.querySelector("#blockRefMode") as HTMLSelectElement).value, 10),
                blockEmbedMode: parseInt((exportConfig.element.querySelector("#blockEmbedMode") as HTMLSelectElement).value, 10),
                fileAnnotationRefMode: parseInt((exportConfig.element.querySelector("#fileAnnotationRefMode") as HTMLSelectElement).value, 10),
                blockRefTextLeft: (exportConfig.element.querySelector("#blockRefTextLeft") as HTMLInputElement).value,
                blockRefTextRight: (exportConfig.element.querySelector("#blockRefTextRight") as HTMLInputElement).value,
                tagOpenMarker: (exportConfig.element.querySelector("#tagOpenMarker") as HTMLInputElement).value,
                tagCloseMarker: (exportConfig.element.querySelector("#tagCloseMarker") as HTMLInputElement).value,
                pandocBin: pandocBin || window.siyuan.config.export.pandocBin,
            }, (response) => {
                exportConfig.onSetexport(response.data);
                pandocBinPathElement.textContent = response.data.pandocBin;
            });
        };
        exportConfig.element.querySelectorAll("select").forEach((item) => {
            item.addEventListener("change", () => {
                setexprt();
            });
        });
        exportConfig.element.querySelectorAll("input").forEach((item) => {
            if (item.id == "importData") {
                item.addEventListener("change", (event: InputEvent & { target: HTMLInputElement }) => {
                    const formData = new FormData();
                    formData.append("file", event.target.files[0]);
                    fetchPost("/api/import/importData", formData);
                });
            } else {
                item.addEventListener("change", () => {
                    setexprt();
                });
            }
        });
        exportConfig.element.querySelector("#exportData").addEventListener("click", () => {
            /// #if BROWSER
            fetchPost("/api/export/exportData", {}, response => {
                window.location.href = response.data.zip;
            });
            /// #else
            dialog.showSaveDialog({
                defaultPath: "data",
                properties: ["showOverwriteConfirmation"],
            }).then((result: SaveDialogReturnValue) => {
                if (!result.canceled) {
                    const id = showMessage(window.siyuan.languages.exporting, -1);
                    fetchPost("/api/export/exportDataInFolder", {
                        folder: result.filePath
                    }, () => {
                        afterExport(result.filePath, id);
                    });
                }
            });
            /// #endif
        });
        /// #if !BROWSER
        pandocBinPathElement.addEventListener("click", () => {
            if (window.siyuan.config.export.pandocBin) {
                shell.showItemInFolder(window.siyuan.config.export.pandocBin);
            }
        });
        const pandocBinElement = exportConfig.element.querySelector("#pandocBin") as HTMLInputElement;
        pandocBinElement.addEventListener("click", async () => {
            const localPath = await dialog.showOpenDialog({
                defaultPath: window.siyuan.config.system.homeDir,
                properties: ["openFile"],
            });
            if (localPath.filePaths.length === 0) {
                pandocBinElement.value = window.siyuan.config.export.pandocBin;
                return;
            }
            setexprt(localPath.filePaths[0]);
        });
        /// #endif
    },
    onSetexport: (data: IExport) => {
        window.siyuan.config.export = data;
    }
};
