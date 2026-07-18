import {Dialog} from "../dialog";
import {Constants} from "../constants";
import {escapeHtml} from "../util/escape";
import {fetchPost} from "../util/fetch";
import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
import {importObsidianVault} from "./importObsidian";
import {saveExportFile, writeText} from "../protyle/util/compatibility";
import {exitSiYuan} from "../dialog/processSystem";
/// #if !MOBILE
import {exportLayout} from "../layout/util";
/// #endif
/// #if !BROWSER
import {ipcRenderer} from "electron";
import * as path from "path";
import {afterExport} from "../protyle/export/util";
/// #endif

interface IDataMigrationOptions {
    mode?: "manage" | "onboarding";
    notebookID?: string;
    onContentImportComplete?: () => void;
}

const getExportButton = (action: string, mode: IDataMigrationOptions["mode"]) => mode === "manage" ?
    `<span class="fn__space"></span><button class="b3-button b3-button--outline" data-action="${action}"><svg><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.export}</button>` : "";

const getImportButton = (type: string, accept: string) => `<button class="b3-button b3-button--outline" style="position:relative">
    <input class="b3-form__upload" data-type="${type}" type="file" accept="${accept}">
    <svg><use xlink:href="#iconDownload"></use></svg>${window.siyuan.languages.import}
</button>`;

const openRepoKeyImport = (onComplete?: () => void) => {
    const dialog = new Dialog({
        title: `🔑 ${window.siyuan.languages.key}`,
        content: `<div class="b3-dialog__content" style="display:flex">
    <textarea spellcheck="false" style="resize:none;flex:1" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.keyPlaceholder}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: "520px",
        height: "260px",
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_PASSWORD);
    const textAreaElement = dialog.element.querySelector("textarea") as HTMLTextAreaElement;
    const buttons = dialog.element.querySelectorAll(".b3-button");
    textAreaElement.focus();
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", () => {
        fetchPost("/api/repo/importRepoKey", {key: textAreaElement.value}, (response) => {
            window.siyuan.config.repo.key = response.data.key;
            dialog.destroy();
            showMessage(window.siyuan.languages.imported);
            onComplete?.();
        });
    });
};

const exportData = async () => {
    /// #if BROWSER
    fetchPost("/api/export/exportData", {}, (response) => {
        if (response.code !== 0) {
            showMessage(response.msg, response.data?.closeTimeout || 0, "error");
            return;
        }
        void saveExportFile(response.data.zip);
    });
    /// #else
    const result = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
        cmd: "showOpenDialog",
        title: `${window.siyuan.languages.export} Data`,
        properties: ["createDirectory", "openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
        return;
    }
    const msgId = showMessage(window.siyuan.languages.exporting, -1);
    fetchPost("/api/export/exportDataInFolder", {folder: result.filePaths[0]}, (response) => {
        afterExport(path.join(result.filePaths[0], response.data.name), msgId);
    });
    /// #endif
};

export const openDataMigration = (options: IDataMigrationOptions = {}) => {
    const mode = options.mode || "manage";
    const hasRepoKey = Boolean(window.siyuan.config.repo.key);
    const helpNotebookIDs = Object.values(Constants.HELP_PATH);
    const notebooks = window.siyuan.notebooks.filter((item) => !item.closed && !helpNotebookIDs.includes(item.id));
    const selectedNotebookID = notebooks.some((item) => item.id === options.notebookID) ? options.notebookID : notebooks[0]?.id;
    const notebookOptions = notebooks.map((item) =>
        `<option value="${item.id}"${item.id === selectedNotebookID ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
    let nativeImportHTML = "";
    /// #if !BROWSER
    nativeImportHTML = `<button class="b3-list-item fn__block" data-type="markdown-file"${notebooks.length === 0 ? " disabled" : ""}>
    <svg class="b3-list-item__graphic"><use xlink:href="#iconMarkdown"></use></svg>
    <span class="b3-list-item__text">Markdown ${window.siyuan.languages.doc}</span>
</button>
<button class="b3-list-item fn__block" data-type="markdown-folder"${notebooks.length === 0 ? " disabled" : ""}>
    <svg class="b3-list-item__graphic"><use xlink:href="#iconFolder"></use></svg>
    <span class="b3-list-item__text">Markdown ${window.siyuan.languages.folder}</span>
</button>
<button class="b3-list-item fn__block" data-type="obsidian">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconObsidian"></use></svg>
    <span class="b3-list-item__text">Obsidian Vault</span>
</button>`;
    /// #endif
    const dialog = new Dialog({
        title: window.siyuan.languages.dataMigration,
        content: `<div class="b3-dialog__content">
    <div class="b3-label__text">SiYuan</div>
    <div class="fn__hr"></div>
    <div class="b3-list b3-list--background">
        <label class="b3-list-item">
            <svg class="b3-list-item__graphic"><use xlink:href="#iconSiYuan"></use></svg>
            <span class="b3-list-item__text">SiYuan .sy.zip</span>
            <input class="b3-form__upload" data-type="siyuan" type="file" accept="application/zip">
        </label>
        <div class="b3-list-item b3-list-item--warning fn__flex-wrap data-migration__item">
            <svg class="b3-list-item__graphic"><use xlink:href="#iconDatabase"></use></svg>
            <span class="b3-list-item__text">Data.zip</span>
            <span class="data-migration__actions">
                ${getImportButton("data", "application/zip")}
                ${getExportButton("export-data", mode)}
            </span>
        </div>
    </div>
    <div class="fn__hr"></div>
    <div class="b3-label__text">${window.siyuan.languages.importFromMoreApps}</div>
    <div class="fn__hr"></div>
    <div class="b3-list b3-list--background">
        <label class="b3-list-item${notebooks.length === 0 ? " data-migration__disabled" : ""}">
            <svg class="b3-list-item__graphic"><use xlink:href="#iconMarkdown"></use></svg>
            <span class="b3-list-item__text">Markdown .zip</span>
            <input class="b3-form__upload" data-type="markdown-zip" type="file" accept="application/zip"${notebooks.length === 0 ? " disabled" : ""}>
        </label>
        ${nativeImportHTML}
    </div>
    <div class="fn__hr"></div>
    <div class="b3-label__text">${window.siyuan.languages.settingsAndSync}</div>
    <div class="fn__hr"></div>
    <div class="b3-list b3-list--background">
        <div class="b3-list-item fn__flex-wrap data-migration__item">
            <svg class="b3-list-item__graphic"><use xlink:href="#iconSettings"></use></svg>
            <span class="b3-list-item__text">${window.siyuan.languages.config}</span>
            <span class="data-migration__actions">
                ${getImportButton("conf", "application/zip,application/json")}
                ${getExportButton("export-conf", mode)}
            </span>
        </div>
        <div class="b3-list-item fn__flex-wrap data-migration__item">
            <svg class="b3-list-item__graphic"><use xlink:href="#iconCloud"></use></svg>
            <span class="b3-list-item__text">S3</span>
            <span class="data-migration__actions">
                ${getImportButton("s3", "application/zip")}
                ${getExportButton("export-s3", mode)}
            </span>
        </div>
        <div class="b3-list-item fn__flex-wrap data-migration__item">
            <svg class="b3-list-item__graphic"><use xlink:href="#iconCloud"></use></svg>
            <span class="b3-list-item__text">WebDAV</span>
            <span class="data-migration__actions">
                ${getImportButton("webdav", "application/zip")}
                ${getExportButton("export-webdav", mode)}
            </span>
        </div>
        ${mode === "onboarding" && hasRepoKey ? "" : `<div class="b3-list-item fn__flex-wrap data-migration__item" data-type="repo-key">
            <svg class="b3-list-item__graphic"><use xlink:href="#iconKey"></use></svg>
            <span class="b3-list-item__text">${window.siyuan.languages.dataRepoKey}</span>
            <span class="data-migration__actions">
                ${hasRepoKey ? `<button class="b3-button b3-button--outline" data-action="copy-key"><svg><use xlink:href="#iconCopy"></use></svg>${window.siyuan.languages.copy}</button>` : `<button class="b3-button b3-button--outline" data-action="import-key"><svg><use xlink:href="#iconDownload"></use></svg>${window.siyuan.languages.import}</button>`}
            </span>
        </div>`}
    </div>
</div>`,
        width: "560px",
    });

    const completeContentImport = () => {
        dialog.destroy();
        options.onContentImportComplete?.();
    };
    let targetNotebookID = selectedNotebookID || "";
    const selectTargetNotebook = (callback: (notebookID: string) => void, onCancel?: () => void) => {
        if (notebooks.length === 0) {
            onCancel?.();
            showMessage(window.siyuan.languages.newFileTip);
            return;
        }
        const targetDialog = new Dialog({
            title: window.siyuan.languages.targetNotebook,
            content: `<div class="b3-dialog__content">
    <select class="b3-select fn__block">${notebookOptions}</select>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            width: "420px",
            destroyCallback: () => {
                if (!targetDialog.data?.confirmed) {
                    onCancel?.();
                }
            },
        });
        const selectElement = targetDialog.element.querySelector("select") as HTMLSelectElement;
        selectElement.value = targetNotebookID;
        const buttons = targetDialog.element.querySelectorAll(".b3-button");
        buttons[0].addEventListener("click", () => targetDialog.destroy());
        buttons[1].addEventListener("click", () => {
            targetNotebookID = selectElement.value;
            targetDialog.data = {confirmed: true};
            targetDialog.destroy();
            callback(targetNotebookID);
        });
    };
    const postFile = (url: string, file: File, extra: Record<string, string> = {},
                      callback: (response: IWebSocketData) => void = completeContentImport) => {
        const formData = new FormData();
        formData.append("file", file);
        Object.entries(extra).forEach(([key, value]) => formData.append(key, value));
        fetchPost(url, formData, callback);
    };
    const bindFileInput = (type: string, callback: (file: File, input: HTMLInputElement) => void) => {
        dialog.element.querySelector(`[data-type="${type}"]`)?.addEventListener("change", (event: Event) => {
            const input = event.target as HTMLInputElement;
            const file = input.files?.[0];
            if (file) {
                callback(file, input);
            }
        });
    };

    bindFileInput("siyuan", (file, input) => {
        input.value = "";
        postFile("/api/import/importSYAuto", file, {notebook: "", toPath: "/"}, (response) => {
            const token = response.data?.token as string | undefined;
            if (response.data?.type !== "document" || !token) {
                completeContentImport();
                return;
            }
            selectTargetNotebook((notebookID) => {
                fetchPost("/api/import/continueImportSY", {token, notebook: notebookID}, completeContentImport);
            }, () => {
                fetchPost("/api/import/cancelImportSY", {token});
            });
        });
    });
    bindFileInput("markdown-zip", (file, input) => {
        input.value = "";
        selectTargetNotebook((notebookID) => {
            postFile("/api/import/importZipMd", file, {notebook: notebookID, toPath: "/"});
        });
    });
    bindFileInput("data", (file, input) => {
        confirmDialog(`${window.siyuan.languages.import} Data`, window.siyuan.languages.importDataTip, () => {
            postFile("/api/import/importData", file);
        });
        input.value = "";
    });
    bindFileInput("conf", (file, input) => {
        input.value = "";
        postFile("/api/system/importConf", file, {}, (response) => {
            if (response.code !== 0) {
                showMessage(response.msg);
                return;
            }
            showMessage(window.siyuan.languages.imported);
            /// #if MOBILE
            void exitSiYuan();
            /// #else
            void exportLayout({errorExit: true, cb: exitSiYuan});
            /// #endif
        });
    });
    ["s3", "webdav"].forEach((provider) => {
        bindFileInput(provider, (file, input) => {
            input.value = "";
            const isS3 = provider === "s3";
            postFile(isS3 ? "/api/sync/importSyncProviderS3" : "/api/sync/importSyncProviderWebDAV", file, {}, (response) => {
                if (isS3) {
                    window.siyuan.config.sync.s3 = response.data.s3;
                } else {
                    window.siyuan.config.sync.webdav = response.data.webdav;
                }
                showMessage(window.siyuan.languages.imported);
            });
        });
    });

    dialog.element.addEventListener("click", (event) => {
        const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
        const exports: Record<string, string> = {
            "export-conf": "/api/system/exportConf",
            "export-s3": "/api/sync/exportSyncProviderS3",
            "export-webdav": "/api/sync/exportSyncProviderWebDAV",
        };
        if (action === "export-data") {
            void exportData();
        } else if (action && exports[action]) {
            fetchPost(exports[action], {}, (response) => void saveExportFile(response.data.zip));
        } else if (action === "import-key") {
            openRepoKeyImport(() => {
                const repoKeyElement = dialog.element.querySelector('[data-type="repo-key"]');
                if (mode === "onboarding") {
                    repoKeyElement?.remove();
                    return;
                }
                const actionsElement = repoKeyElement?.querySelector(".data-migration__actions");
                if (actionsElement) {
                    actionsElement.innerHTML = `<button class="b3-button b3-button--outline" data-action="copy-key"><svg><use xlink:href="#iconCopy"></use></svg>${window.siyuan.languages.copy}</button>`;
                }
            });
        } else if (action === "copy-key") {
            writeText(window.siyuan.config.repo.key);
            showMessage(window.siyuan.languages.copied);
        }
    });

    /// #if !BROWSER
    const importMarkdown = async (isFile: boolean) => {
        if (notebooks.length === 0) {
            showMessage(window.siyuan.languages.newFileTip);
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
        selectTargetNotebook((notebookID) => {
            fetchPost("/api/import/importStdMd", {
                notebook: notebookID,
                localPath: localPath.filePaths[0],
                toPath: "/",
            }, completeContentImport);
        });
    };
    dialog.element.querySelector('[data-type="markdown-file"]')?.addEventListener("click", () => void importMarkdown(true));
    dialog.element.querySelector('[data-type="markdown-folder"]')?.addEventListener("click", () => void importMarkdown(false));
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
        dialog.destroy();
        await importObsidianVault(localPath.filePaths[0], options.onContentImportComplete);
    });
    /// #endif
};
