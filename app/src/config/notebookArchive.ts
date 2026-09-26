import {Dialog} from "../dialog";
import {showMessage} from "../dialog/message";
import {fetchSyncPost} from "../util/fetch";
import {ContractFormData} from "../util/contractFormData";
import {saveExportFile} from "../protyle/util/compatibility";
import {escapeHtml} from "../util/escape";
import {isMobile} from "../util/functions";

export const openNotebookArchiveDialog = async (refresh: () => void) => {
    const response = await fetchSyncPost("/api/notebook/getNotebookArchiveCandidates", {});
    if (response.code !== 0) {
        return;
    }
    const lang = window.siyuan.languages;
    const dialog = new Dialog({
        title: lang.archiveEncryptedNotebooks,
        width: isMobile() ? "92vw" : "560px",
        content: `<div class="b3-dialog__content">
    <div class="ft__secondary">${lang.archiveEncryptedNotebooksTip}</div>
    <div class="fn__hr"></div>
    <div data-type="notebooks">${response.data.notebooks.map((item) => `<label class="b3-label fn__flex">
        <input class="b3-switch" type="checkbox" value="${escapeHtml(item.id)}">
        <span class="fn__space"></span><span class="ft__breakword">${escapeHtml(item.id)}${item.current ? "" : ` (${lang.archiveHistoryOnly})`}</span>
    </label>`).join("")}</div>
    <label class="b3-label fn__flex fn__none" data-type="saved">
        <input class="b3-switch" type="checkbox"><span class="fn__space"></span>
        <span class="ft__breakword">${lang.confirmArchiveSaved}</span>
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${lang.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-type="export" disabled>${lang.export}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--remove fn__none" data-type="commit" disabled>${lang.archiveEncryptedNotebooks}</button>
</div>`,
    });
    const boxes = dialog.element.querySelectorAll<HTMLInputElement>('[data-type="notebooks"] input');
    const exportButton = dialog.element.querySelector<HTMLButtonElement>('[data-type="export"]');
    const commitButton = dialog.element.querySelector<HTMLButtonElement>('[data-type="commit"]');
    const saved = dialog.element.querySelector<HTMLInputElement>('[data-type="saved"] input');
    let archive: {id: string, file: string} | undefined;
    let busy = false;
    const update = () => {
        exportButton.disabled = busy || !Array.from(boxes).some((box) => box.checked);
        commitButton.disabled = busy || !archive || !saved.checked;
    };
    boxes.forEach((box) => box.addEventListener("change", update));
    saved.addEventListener("change", update);
    dialog.element.querySelector('[data-type="cancel"]').addEventListener("click", () => dialog.destroy());
    exportButton.addEventListener("click", async () => {
        if (busy) {
            return;
        }
        busy = true;
        update();
        try {
            if (!archive) {
                const prepared = await fetchSyncPost("/api/notebook/prepareNotebookArchive", {
                    notebooks: Array.from(boxes).filter((box) => box.checked).map((box) => box.value),
                });
                if (prepared.code !== 0) {
                    return;
                }
                archive = prepared.data;
                boxes.forEach((box) => box.disabled = true);
            }
            const result = await saveExportFile(archive.file);
            if (result.status !== "success" || !dialog.element.isConnected) {
                return;
            }
            // 下载回调不代替用户确认，浏览器及旧版移动端可能仅报告已发起下载。
            dialog.element.querySelector('[data-type="saved"]').classList.remove("fn__none");
            commitButton.classList.remove("fn__none");
        } finally {
            busy = false;
            update();
        }
    });
    commitButton.addEventListener("click", async () => {
        if (busy || !archive || !saved.checked) {
            return;
        }
        busy = true;
        update();
        try {
            const result = await fetchSyncPost("/api/notebook/commitNotebookArchive", {id: archive.id, saved: true});
            if (result.code !== 0) {
                return;
            }
            dialog.destroy();
            showMessage(lang.archivedEncryptedNotebooks, 10000);
            refresh();
        } finally {
            busy = false;
            update();
        }
    });
};

export const openNotebookArchiveImportDialog = (refresh: () => void) => {
    const lang = window.siyuan.languages;
    const dialog = new Dialog({
        title: lang.restoreEncryptedNotebooks,
        width: isMobile() ? "92vw" : "560px",
        content: `<div class="b3-dialog__content">
    <div class="ft__secondary">${lang.restoreEncryptedNotebooksTip}</div>
    <label class="b3-label fn__block">${lang.restoreEncryptedNotebooks}
        <div class="fn__hr"></div><input class="b3-text-field fn__block" data-type="archive" type="file" accept=".zip,application/zip" required>
    </label>
    <label class="b3-label fn__block">${lang.archiveKeyFile}
        <div class="fn__hr"></div><input class="b3-text-field fn__block" data-type="key" type="file" accept=".json,application/json">
    </label>
    <label class="b3-label fn__block">${lang.masterPassword}
        <div class="fn__hr"></div><input class="b3-text-field fn__block" data-type="password" type="password" autocomplete="off" required>
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${lang.cancel}</button>
    <div class="fn__space"></div><button class="b3-button b3-button--text" data-type="import">${lang.import}</button>
</div>`,
    });
    dialog.element.querySelector('[data-type="cancel"]').addEventListener("click", () => dialog.destroy());
    const button = dialog.element.querySelector<HTMLButtonElement>('[data-type="import"]');
    button.addEventListener("click", async () => {
        if (button.disabled) {
            return;
        }
        const file = dialog.element.querySelector<HTMLInputElement>('[data-type="archive"]').files?.[0];
        const key = dialog.element.querySelector<HTMLInputElement>('[data-type="key"]').files?.[0];
        const password = dialog.element.querySelector<HTMLInputElement>('[data-type="password"]').value.trim();
        if (!file || !password) {
            dialog.element.querySelector<HTMLInputElement>(`[data-type="${file ? "password" : "archive"}"]`).reportValidity();
            return;
        }
        button.disabled = true;
        try {
            const response = await fetchSyncPost("/api/notebook/importNotebookArchive", new ContractFormData({file, key, password}), undefined, false);
            if (response.code !== 0) {
                showMessage(response.msg, 7000, "error");
                return;
            }
            dialog.destroy();
            showMessage(lang.imported);
            refresh();
            // 导入保留锁定状态，刷新导航即可显示新恢复的笔记本。
            window.location.reload();
        } finally {
            button.disabled = false;
        }
    });
};
