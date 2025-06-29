import {Constants} from "../constants";
import {showMessage} from "../dialog/message";
import {isMobile} from "./functions";
import {fetchPost} from "./fetch";
import {Dialog} from "../dialog";
import {getOpenNotebookCount} from "./pathName";
import {validateName} from "../editor/rename";
import {setStorageVal} from "../protyle/util/compatibility";
import {openFileById} from "../editor/util";
import {openMobileFileById} from "../mobile/editor";
import {App} from "../index";
import {getActiveTab} from "../layout/tabUtil";
import {Editor} from "../editor";

const getCurrentDocumentId = () => {
    const activeTab = getActiveTab();
    if (activeTab && activeTab.model instanceof Editor) {
        return activeTab.model.editor.protyle.block.rootID;
    }
    return null;
};

export const fetchNewDailyNote = (app: App, notebook: string, forceOpen = false) => {
    fetchPost("/api/filetree/createDailyNote", {
        notebook,
        app: Constants.SIYUAN_APPID,
    }, (response) => {
        const dailyNoteId = response.data.id;
        const currentDocId = getCurrentDocumentId();
        
        if (!forceOpen && currentDocId === dailyNoteId) {
            showNotebookSelectionDialog(app);
            return;
        }
        
        /// #if MOBILE
        openMobileFileById(app, dailyNoteId);
        /// #else
        openFileById({app, id: dailyNoteId, action: [Constants.CB_GET_FOCUS]});
        /// #endif
    });
};

const showNotebookSelectionDialog = (app: App) => {
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
    <div class="b3-label" style="margin-bottom: 8px;">${window.siyuan.languages.plsChooseAnotherNotebook}</div>
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
    
    const localNotebookId = window.siyuan.storage[Constants.LOCAL_DAILYNOTEID];
    if (localNotebookId) {
        selectElement.value = localNotebookId;
    }
    
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    
    btnsElement[1].addEventListener("click", () => {
        const notebook = selectElement.value;
        window.siyuan.storage[Constants.LOCAL_DAILYNOTEID] = notebook;
        setStorageVal(Constants.LOCAL_DAILYNOTEID, window.siyuan.storage[Constants.LOCAL_DAILYNOTEID]);
        fetchNewDailyNote(app, notebook, true); // force open, avoid dialog loop
        dialog.destroy();
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
    const notebookId = Constants.HELP_PATH[window.siyuan.config.appearance.lang as "zh_CN" | "en_US"];
    fetchPost("/api/notebook/removeNotebook", {notebook: notebookId, callback: Constants.CB_MOUNT_REMOVE}, () => {
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
        const name = dialog.element.querySelector("input").value;
        if (!validateName(name)) {
            return false;
        }
        fetchPost("/api/notebook/createNotebook", {
            name
        });
        dialog.destroy();
    });
};
