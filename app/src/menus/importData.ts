import {Dialog} from "../dialog";
import {Constants} from "../constants";
import {escapeHtml} from "../util/escape";
import {fetchPost} from "../util/fetch";
import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
import {importObsidianVault} from "./importObsidian";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

interface IImportDataOptions {
    notebookID?: string;
    onComplete?: () => void;
}

export const openImportData = (options: IImportDataOptions = {}) => {
    const helpNotebookIDs = Object.values(Constants.HELP_PATH);
    const notebooks = window.siyuan.notebooks.filter((item) => !item.closed && !helpNotebookIDs.includes(item.id));
    const selectedNotebookID = notebooks.some((item) => item.id === options.notebookID) ? options.notebookID : notebooks[0]?.id;
    const notebookOptions = notebooks.map((item) =>
        `<option value="${item.id}"${item.id === selectedNotebookID ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
    let nativeImportHTML = "";
    /// #if !BROWSER
    nativeImportHTML = `<button class="b3-list-item" data-type="markdown-file">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconMarkdown"></use></svg>
    <span class="b3-list-item__text">Markdown ${window.siyuan.languages.doc}</span>
</button>
<button class="b3-list-item" data-type="markdown-folder">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconFolder"></use></svg>
    <span class="b3-list-item__text">Markdown ${window.siyuan.languages.folder}</span>
</button>
<button class="b3-list-item" data-type="obsidian">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconObsidian"></use></svg>
    <span class="b3-list-item__text">${window.siyuan.languages.obsidianVaultImport}</span>
</button>`;
    /// #endif
    const dialog = new Dialog({
        title: window.siyuan.languages.import,
        content: `<div class="b3-dialog__content">
    <label class="fn__flex b3-label">
        <span class="b3-label__text">${window.siyuan.languages.currentNotebook}</span>
        <span class="fn__space"></span>
        <select class="b3-select fn__flex-1" data-type="notebook"${notebooks.length === 0 ? " disabled" : ""}>${notebookOptions || `<option>${window.siyuan.languages.newFileTip}</option>`}</select>
    </label>
    <div class="fn__hr"></div>
    <div class="b3-label__text">SiYuan</div>
    <div class="b3-list b3-list--background">
        <label class="b3-list-item">
            <svg class="b3-list-item__graphic"><use xlink:href="#iconSiYuan"></use></svg>
            <span class="b3-list-item__text">SiYuan .sy.zip</span>
            <input class="b3-form__upload" data-type="siyuan" type="file" accept="application/zip">
        </label>
        <label class="b3-list-item b3-list-item--warning">
            <svg class="b3-list-item__graphic"><use xlink:href="#iconDatabase"></use></svg>
            <span class="b3-list-item__text">Data.zip</span>
            <input class="b3-form__upload" data-type="data" type="file" accept="application/zip">
        </label>
    </div>
    <div class="fn__hr"></div>
    <div class="b3-label__text">${window.siyuan.languages.importFromMoreApps}</div>
    <div class="b3-list b3-list--background">
        <label class="b3-list-item">
            <svg class="b3-list-item__graphic"><use xlink:href="#iconMarkdown"></use></svg>
            <span class="b3-list-item__text">Markdown .zip</span>
            <input class="b3-form__upload" data-type="markdown-zip" type="file" accept="application/zip">
        </label>
        ${nativeImportHTML}
    </div>
</div>`,
        width: "520px",
    });

    const complete = () => {
        dialog.destroy();
        options.onComplete?.();
    };
    const getNotebookID = () => notebooks.length > 0 ?
        (dialog.element.querySelector('[data-type="notebook"]') as HTMLSelectElement).value : "";
    const getRequiredNotebookID = () => {
        const notebookID = getNotebookID();
        if (!notebookID) {
            showMessage(window.siyuan.languages.newFileTip);
        }
        return notebookID;
    };
    const postFile = (url: string, file: File, extra: Record<string, string> = {}) => {
        const formData = new FormData();
        formData.append("file", file);
        Object.entries(extra).forEach(([key, value]) => formData.append(key, value));
        fetchPost(url, formData, complete);
    };

    dialog.element.querySelector('[data-type="siyuan"]').addEventListener("change", (event: InputEvent & {
        target: HTMLInputElement
    }) => {
        const file = event.target.files?.[0];
        if (file) {
            event.target.value = "";
            postFile("/api/import/importSYAuto", file, {notebook: getNotebookID(), toPath: "/"});
        }
    });
    dialog.element.querySelector('[data-type="markdown-zip"]').addEventListener("change", (event: InputEvent & {
        target: HTMLInputElement
    }) => {
        const file = event.target.files?.[0];
        if (file) {
            const notebookID = getRequiredNotebookID();
            event.target.value = "";
            if (notebookID) {
                postFile("/api/import/importZipMd", file, {notebook: notebookID, toPath: "/"});
            }
        }
    });
    dialog.element.querySelector('[data-type="data"]').addEventListener("change", (event: InputEvent & {
        target: HTMLInputElement
    }) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }
        confirmDialog(`${window.siyuan.languages.import} Data`, window.siyuan.languages.importDataTip, () => {
            postFile("/api/import/importData", file);
        });
        event.target.value = "";
    });

    /// #if !BROWSER
    const importMarkdown = async (isFile: boolean) => {
        const notebookID = getRequiredNotebookID();
        if (!notebookID) {
            return;
        }
        const localPath = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
            cmd: "showOpenDialog",
            defaultPath: window.siyuan.config.system.homeDir,
            filters: isFile ? [{name: "Markdown", extensions: ["md", "markdown"]}] : [],
            properties: [isFile ? "openFile" : "openDirectory"],
        });
        if (localPath.filePaths.length === 0) {
            return;
        }
        fetchPost("/api/import/importStdMd", {
            notebook: notebookID,
            localPath: localPath.filePaths[0],
            toPath: "/",
        }, complete);
    };
    dialog.element.querySelector('[data-type="markdown-file"]')?.addEventListener("click", () => {
        void importMarkdown(true);
    });
    dialog.element.querySelector('[data-type="markdown-folder"]')?.addEventListener("click", () => {
        void importMarkdown(false);
    });
    dialog.element.querySelector('[data-type="obsidian"]')?.addEventListener("click", async () => {
        const localPath = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
            cmd: "showOpenDialog",
            singleton: "obsidianVault",
            defaultPath: window.siyuan.config.system.homeDir,
            properties: ["openDirectory"],
        });
        if (localPath.filePaths.length === 0) {
            return;
        }
        complete();
        await importObsidianVault(localPath.filePaths[0]);
    });
    /// #endif
};
