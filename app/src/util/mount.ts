import {Constants} from "../constants";
import {showMessage} from "../dialog/message";
import {isMobile} from "./functions";
import {fetchPost, fetchSyncPost} from "./fetch";
import {Dialog} from "../dialog";
import {getOpenNotebookCount} from "./pathName";
import {replaceFileName, validateName} from "../editor/rename";
import {setStorageVal} from "../protyle/util/compatibility";
import {openFileById} from "../editor/util";
import {openMobileFileById} from "../mobile/editor";
import {App} from "../index";
/// #if !BROWSER
import {ipcRenderer} from "electron";
import {importObsidianVault} from "../menus/importObsidian";
/// #endif

export const fetchNewDailyNote = (app: App, notebook: string) => {
    fetchPost("/api/filetree/createDailyNote", {
        notebook,
        app: Constants.SIYUAN_APPID,
    }, (response) => {
        /// #if MOBILE
        openMobileFileById(app, response.data.id, [Constants.CB_GET_SCROLL, Constants.CB_GET_FOCUS]);
        /// #else
        openFileById({app, id: response.data.id, action: [Constants.CB_GET_SCROLL, Constants.CB_GET_FOCUS]});
        /// #endif
    });
};

export const newDailyNote = (app: App) => {
    const exit = window.siyuan.dialogs.find(item => {
        if (item.element.getAttribute("data-key") === Constants.DIALOG_DIALYNOTE) {
            item.destroy();
            return true;
        }
    });
    if (exit) {
        return;
    }
    const openCount = getOpenNotebookCount();
    if (openCount === 0) {
        showMessage(window.siyuan.languages.newFileTip);
        return;
    }
    if (openCount === 1) {
        let notebookId = "";
        window.siyuan.notebooks.find(item => {
            if (!item.closed) {
                notebookId = item.id;
            }
        });
        fetchNewDailyNote(app, notebookId);
        return;
    }
    const localNotebookId = window.siyuan.storage[Constants.LOCAL_DAILYNOTEID];
    const localNotebookIsOpen = window.siyuan.notebooks.find((item) => {
        if (item.id === localNotebookId && !item.closed) {
            return true;
        }
    });
    if (localNotebookId && localNotebookIsOpen && !isMobile()) {
        fetchNewDailyNote(app, localNotebookId);
    } else {
        let optionsHTML = "";
        window.siyuan.notebooks.forEach(item => {
            if (!item.closed) {
                optionsHTML += `<option value="${item.id}">${item.name}</option>`;
            }
        });
        const dialog = new Dialog({
            positionId: Constants.DIALOG_DIALYNOTE,
            title: window.siyuan.languages.plsChoose,
            content: `<div class="b3-dialog__content">
    <select class="b3-select fn__block">${optionsHTML}</select>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            width: isMobile() ? "92vw" : "520px",
        });
        dialog.element.setAttribute("data-key", Constants.DIALOG_DIALYNOTE);
        const btnsElement = dialog.element.querySelectorAll(".b3-button");
        const selectElement = dialog.element.querySelector(".b3-select") as HTMLSelectElement;
        selectElement.value = localNotebookId;
        btnsElement[0].addEventListener("click", () => {
            dialog.destroy();
        });
        btnsElement[1].addEventListener("click", () => {
            const notebook = selectElement.value;
            window.siyuan.storage[Constants.LOCAL_DAILYNOTEID] = notebook;
            setStorageVal(Constants.LOCAL_DAILYNOTEID, window.siyuan.storage[Constants.LOCAL_DAILYNOTEID]);
            fetchNewDailyNote(app, notebook);
            dialog.destroy();
        });
    }
};

export const mountHelp = () => {
    const notebookId = Constants.HELP_PATH[window.siyuan.config.appearance.lang];
    fetchPost("/api/notebook/removeNotebook", {notebook: notebookId}, () => {
        fetchPost("/api/notebook/openNotebook", {
            notebook: notebookId,
            app: Constants.SIYUAN_APPID,
        });
    });
};

export const newNotebook = () => {
    let importObsidianHTML = "";
    /// #if !BROWSER
    importObsidianHTML = "<div class=\"b3-list-item fn__pointer\" data-type=\"import-obsidian\" role=\"button\" tabindex=\"0\"><svg class=\"b3-list-item__graphic\"><use xlink:href=\"#iconObsidian\"></use></svg><span class=\"b3-list-item__text\">Obsidian Vault</span></div>";
    /// #endif
    const dialog = new Dialog({
        title: window.siyuan.languages.newNotebook,
        content: `<div class="b3-dialog__content">
    <input placeholder="${window.siyuan.languages.notebookName}" class="b3-text-field fn__block">
    <div class="fn__hr"></div>
    <div class="b3-label__text fn__pointer fn__flex" style="align-items: center;gap: 4px" data-type="toggle-import" role="button" tabindex="0" aria-expanded="false"><svg class="b3-list-item__arrow" style="display: block;flex: none;height: 14px;width: 14px" data-type="import-arrow"><use xlink:href="#iconRight"></use></svg><span style="line-height: 20px">${window.siyuan.languages.importFromMoreApps}</span></div>
    <div class="b3-list--background fn__none" data-type="import-options" style="padding-top: 8px">
        <label class="b3-list-item fn__pointer" data-type="import-sy"><svg class="b3-list-item__graphic"><use xlink:href="#iconSiYuan"></use></svg><span class="b3-list-item__text">SiYuan .sy.zip</span><input class="b3-form__upload" type="file" accept="application/zip"></label>
        ${importObsidianHTML}
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-type="confirm">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px"
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_CREATENOTEBOOK);
    const cancelElement = dialog.element.querySelector('[data-type="cancel"]');
    const confirmElement = dialog.element.querySelector('[data-type="confirm"]');
    dialog.bindInput(dialog.element.querySelector("input"), () => {
        confirmElement.dispatchEvent(new CustomEvent("click"));
    });
    cancelElement.addEventListener("click", () => {
        dialog.destroy();
    });
    confirmElement.addEventListener("click", () => {
        let name = dialog.element.querySelector("input").value;
        if (!validateName(name)) {
            return false;
        }
        name = replaceFileName(name);
        fetchPost("/api/notebook/createNotebook", {
            name
        });
        dialog.destroy();
    });
    const toggleImportElement = dialog.element.querySelector('[data-type="toggle-import"]') as HTMLElement;
    const importOptionsElement = dialog.element.querySelector('[data-type="import-options"]') as HTMLElement;
    const importArrowElement = toggleImportElement.querySelector('[data-type="import-arrow"]') as SVGElement;
    const toggleImportOptions = () => {
        const expanded = importOptionsElement.classList.toggle("fn__none") === false;
        toggleImportElement.setAttribute("aria-expanded", expanded.toString());
        importArrowElement.classList.toggle("b3-list-item__arrow--open", expanded);
    };
    toggleImportElement.addEventListener("click", toggleImportOptions);
    toggleImportElement.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleImportOptions();
        }
    });
    dialog.element.querySelector('[data-type="import-sy"] .b3-form__upload').addEventListener("change", (event: InputEvent & {
        target: HTMLInputElement
    }) => {
        if (!event.target.files?.[0]) {
            return;
        }
        const formData = new FormData();
        formData.append("file", event.target.files[0]);
        dialog.destroy();
        fetchPost("/api/import/importSYNotebook", formData);
    });
    /// #if !BROWSER
    const importObsidianElement = dialog.element.querySelector('[data-type="import-obsidian"]') as HTMLElement;
    let selectingObsidianVault = false;
    const selectObsidianVault = async () => {
        if (selectingObsidianVault) {
            return;
        }
        selectingObsidianVault = true;
        try {
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
            importObsidianVault(localPath.filePaths[0]);
        } finally {
            selectingObsidianVault = false;
        }
    };
    importObsidianElement.addEventListener("click", selectObsidianVault);
    importObsidianElement.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectObsidianVault();
        }
    });
    /// #endif
};

export const newEncryptedNotebook = () => {
    // 先检查加密功能是否已启用；未启用则提示去设置页启用
    fetchPost("/api/notebook/getEncryptedNotebookStatus", {}, (response) => {
        if (!response.data.enabled) {
            showMessage(window.siyuan.languages.encryptedNotebookTip, 6000);
            return;
        }
        const dialog = new Dialog({
            title: window.siyuan.languages.newEncryptedNotebook,
            content: `<div class="b3-dialog__content">
    <input placeholder="${window.siyuan.languages.notebookName}" class="b3-text-field fn__block">
    <div class="fn__hr"></div>
    <input type="password" placeholder="${window.siyuan.languages.masterPassword}" class="b3-text-field fn__block">
    <div class="fn__hr--b"></div>
    <div>${window.siyuan.languages.encryptedNotebookRiskTip}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            width: isMobile() ? "92vw" : "520px"
        });
        const btnsElement = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-button");
        const inputs = dialog.element.querySelectorAll("input");
        dialog.bindInput(inputs[0], () => {
            btnsElement[1].dispatchEvent(new CustomEvent("click"));
        });
        btnsElement[0].addEventListener("click", () => {
            dialog.destroy();
        });
        btnsElement[1].addEventListener("click", async () => {
            const name = inputs[0].value;
            const password = inputs[1].value;
            if (!validateName(name)) {
                return false;
            }
            if (!password) {
                showMessage(window.siyuan.languages.masterPassword);
                return false;
            }
            btnsElement[1].disabled = true;
            const response = await fetchSyncPost("/api/notebook/createEncryptedNotebook", {
                name: replaceFileName(name),
                password
            });
            if (response.code === 0) {
                // createEncryptedNotebook 内核已原子完成创建+挂载，无需再单独 openNotebook
                dialog.destroy();
            } else {
                btnsElement[1].disabled = false;
            }
        });
    });
};

export const openEncryptedNotebook = (app: App, notebookId: string, name: string) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.unlockEncryptedNotebook.replace("${x}", name),
        content: `<div class="b3-dialog__content">
    <input type="password" placeholder="${window.siyuan.languages.masterPassword}" class="b3-text-field fn__block">
    <div class="fn__hr--b"></div>
    <div>${window.siyuan.languages.encryptedNotebookRiskTip}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px"
    });
    const btnsElement = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-button");
    const inputElement = dialog.element.querySelector("input");
    dialog.bindInput(inputElement, () => {
        btnsElement[1].dispatchEvent(new CustomEvent("click"));
    });
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", async () => {
        const password = inputElement.value;
        if (!password) {
            return false;
        }
        btnsElement[1].disabled = true;
        // 原子化解锁并挂载：UnlockBox 成功后立即 Mount，Mount 失败则后端自动 LockBox 回滚，避免 DEK 残留
        const response = await fetchSyncPost("/api/notebook/unlockAndOpenNotebook", {
            notebook: notebookId,
            password
        });
        if (response.code === 0) {
            dialog.destroy();
        } else {
            btnsElement[1].disabled = false;
            inputElement.value = "";
            inputElement.focus();
        }
    });
};
