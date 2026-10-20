import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
import {forgetNotebookHistoryDialog, trackNotebookHistoryDialog} from "../history/notebookDialogs";
import {escapeHtml} from "../util/escape";
import {fetchSyncPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {getNotebookName} from "../util/pathName";
import {AssetPreview} from "./assetPreview";
import {runSettingsMaintenance} from "./setting/maintenance";
import type {AssetUnusedItem} from "../types/api";

export const canCleanEncryptedNotebookAssets = (notebook: string) => !window.siyuan.config.readonly &&
    window.siyuan.notebooks.some(item => item.id === notebook && item.encrypted && !item.closed);

export const openEncryptedAssetsCleanup = (notebook: string) => {
    if (!canCleanEncryptedNotebookAssets(notebook)) {
        return;
    }
    const lang = window.siyuan.languages;
    let busy = false;
    let disposed = false;
    let items: AssetUnusedItem[] = [];
    const dialog = new Dialog({
        title: `${escapeHtml(getNotebookName(notebook))} - ${lang.cleanUnusedAssets}`,
        width: isMobile() ? "92vw" : "720px",
        height: "72vh",
        content: `<div class="b3-dialog__content fn__flex-column">
    <div class="fn__flex">
        <label class="fn__flex"><input class="b3-switch" type="checkbox" data-type="all"><span class="fn__space"></span>${lang.selectAll}</label>
        <span class="fn__flex-1"></span><span class="ft__secondary" data-type="count"></span>
    </div>
    <div class="fn__hr"></div>
    <div class="b3-list b3-list--background config-assets__list" data-type="list"></div>
    <div class="config-assets__preview fn__none" data-type="preview"></div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${lang.cancel}</button>
    <div class="fn__space"></div><button class="b3-button b3-button--outline" data-type="refresh">${lang.refresh}</button>
    <div class="fn__space"></div><button class="b3-button b3-button--remove" data-type="delete" disabled>${lang.delete}</button>
</div>`,
        destroyCallback: () => {
            disposed = true;
            items = [];
            preview.clear();
            forgetNotebookHistoryDialog(dialog);
        },
    });
    trackNotebookHistoryDialog(dialog, [notebook]);
    const list = dialog.element.querySelector<HTMLElement>('[data-type="list"]');
    const all = dialog.element.querySelector<HTMLInputElement>('[data-type="all"]');
    const remove = dialog.element.querySelector<HTMLButtonElement>('[data-type="delete"]');
    const refresh = dialog.element.querySelector<HTMLButtonElement>('[data-type="refresh"]');
    const previewElement = dialog.element.querySelector<HTMLElement>('[data-type="preview"]');
    const preview = new AssetPreview(previewElement);
    const active = () => !disposed && dialog.element.isConnected && dialog.element.dataset.dialogClosing !== "true";
    const boxes = () => Array.from(list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const update = () => {
        const inputs = boxes();
        const selected = inputs.filter(input => input.checked).length;
        all.checked = inputs.length > 0 && selected === inputs.length;
        all.indeterminate = selected > 0 && selected < inputs.length;
        all.disabled = busy || inputs.length === 0;
        inputs.forEach(input => input.disabled = busy);
        remove.disabled = busy || selected === 0;
        refresh.disabled = busy;
        dialog.element.querySelector('[data-type="count"]').textContent = `${selected} / ${items.length}`;
    };
    const scan = async () => {
        if (busy || !active()) {
            return;
        }
        busy = true;
        items = [];
        preview.clear();
        previewElement.classList.add("fn__none");
        list.textContent = lang.loading;
        update();
        try {
            const response = await fetchSyncPost("/api/asset/getUnusedEncryptedBoxAssets", {notebook});
            if (!active()) {
                return;
            }
            if (response.code !== 0) {
                list.textContent = response.msg;
                return;
            }
            items = response.data;
            list.innerHTML = items.length ? items.map((item, index) => `<div class="b3-list-item" data-index="${index}">
    <input class="b3-switch" type="checkbox" aria-label="${escapeHtml(item.name)}"><span class="fn__space"></span>
    <button class="b3-button b3-button--text fn__flex-1" data-type="preview-item">${escapeHtml(item.name)}</button>
</div>`).join("") : `<div class="b3-list--empty">${lang.emptyContent}</div>`;
        } catch (error) {
            if (active()) {
                list.textContent = String(error);
            }
        } finally {
            busy = false;
            if (active()) {
                update();
            }
        }
    };
    all.addEventListener("change", () => {
        boxes().forEach(input => input.checked = all.checked);
        update();
    });
    list.addEventListener("change", update);
    list.addEventListener("click", event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-type="preview-item"]');
        if (busy || !target) {
            return;
        }
        const item = items[Number(target.closest<HTMLElement>("[data-index]").dataset.index)];
        previewElement.classList.remove("fn__none");
        preview.show(item.path, `${notebook}/${item.item}`);
    });
    refresh.addEventListener("click", () => void scan());
    dialog.element.querySelector('[data-type="cancel"]').addEventListener("click", () => dialog.destroy());
    remove.addEventListener("click", () => {
        if (busy || !active()) {
            return;
        }
        const paths = boxes().filter(input => input.checked)
            .map(input => items[Number(input.closest<HTMLElement>("[data-index]").dataset.index)].item);
        if (!paths.length) {
            return;
        }
        confirmDialog(lang.deleteOpConfirm, `${escapeHtml(getNotebookName(notebook))} - ${lang.clearAll}`, () => {
            if (!active() || busy) {
                return;
            }
            busy = true;
            update();
            void runSettingsMaintenance(async () => {
                const response = await fetchSyncPost("/api/asset/removeUnusedEncryptedBoxAssets", {notebook, paths});
                if (response.code === 0 && active()) {
                    showMessage(lang.deleted);
                }
            }).finally(async () => {
                busy = false;
                if (active()) {
                    await scan();
                }
            });
        });
    });
    void runSettingsMaintenance(scan);
};
