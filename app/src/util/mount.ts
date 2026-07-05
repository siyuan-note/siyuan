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
    const dialog = new Dialog({
        title: window.siyuan.languages.newNotebook,
        content: `<div class="b3-dialog__content">
    <input placeholder="${window.siyuan.languages.notebookName}" class="b3-text-field fn__block">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px"
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_CREATENOTEBOOK);
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    dialog.bindInput(dialog.element.querySelector("input"), () => {
        btnsElement[1].dispatchEvent(new CustomEvent("click"));
    });
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
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
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            width: isMobile() ? "92vw" : "520px"
        });
        const btnsElement = dialog.element.querySelectorAll(".b3-button");
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
            // 创建含 KEK 派生 + 开加密 db，约耗时 1 秒
            const confirmBtn = btnsElement[1] as HTMLButtonElement;
            const originalText = confirmBtn.textContent;
            confirmBtn.setAttribute("disabled", "disabled");
            confirmBtn.textContent = window.siyuan.languages.loading;
            const response = await fetchSyncPost("/api/notebook/createEncryptedNotebook", {
                name: replaceFileName(name),
                password
            });
            if (response.code === 0) {
                // 内核创建时已解锁（DEK 已缓存 + 加密 db 已打开），直接挂载
                fetchPost("/api/notebook/openNotebook", {
                    notebook: response.data.notebook.id
                });
                dialog.destroy();
            } else {
                confirmBtn.removeAttribute("disabled");
                confirmBtn.textContent = originalText;
            }
        });
    });
};

export const openEncryptedNotebook = (app: App, notebookId: string, name: string) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.unlockEncryptedNotebook.replace("${x}", name),
        content: `<div class="b3-dialog__content">
    <input type="password" placeholder="${window.siyuan.languages.masterPassword}" class="b3-text-field fn__block">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px"
    });
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
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
        const unlockBtn = btnsElement[1] as HTMLButtonElement;
        const originalText = unlockBtn.textContent;
        unlockBtn.setAttribute("disabled", "disabled");
        unlockBtn.textContent = window.siyuan.languages.loading;
        // 先解锁（派生 KEK + 解 DEK + 打开加密 db，Argon2id 约耗时 1 秒），成功后再挂载
        const response = await fetchSyncPost("/api/notebook/unlockBox", {
            notebook: notebookId,
            password
        });
        if (response.code === 0) {
            fetchPost("/api/notebook/openNotebook", {
                notebook: notebookId
            });
            dialog.destroy();
        } else {
            // fetchSyncPost 已通过 processMessage 弹出错误提示，这里只需恢复按钮
            unlockBtn.removeAttribute("disabled");
            unlockBtn.textContent = originalText;
        }
    });
};
