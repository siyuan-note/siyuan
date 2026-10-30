import {Dialog} from "../dialog";
import {fetchSyncPost} from "../util/fetch";
import {ContractFormData} from "../util/contractFormData";
import {escapeHtml} from "../util/escape";
import {isMobile} from "../util/functions";
import type {CommitDataImportRequestInput, DataImportPlan} from "../types/api";
import {showMessage} from "../dialog/message";

export const needsDataImportPassword = (plan: DataImportPlan, mode: "skip" | "overwrite") =>
    plan.encrypted.some((id) => mode === "overwrite" || !plan.conflicts.includes(id));

// 桌面设置与移动端数据迁移共用预检、冲突选择和认证流程。
export const importDataFile = async (file: File, onComplete?: () => void) => {
    const prepared = await fetchSyncPost("/api/import/prepareDataImport", new ContractFormData({file})).catch((error): null => {
        showMessage(error instanceof Error ? error.message : String(error), 0, "error");
        return null;
    });
    if (!prepared || prepared.code !== 0) {
        return;
    }
    const plan = prepared.data;
    const lang = window.siyuan.languages;
    let busy = false;
    let committed = false;
    let closed = false;
    const cancel = () => {
        if (!busy && !committed) {
            void fetchSyncPost("/api/import/cancelDataImport", {id: plan.id}, undefined, false).catch(() => {});
        }
    };
    const dialog = new Dialog({
        title: `${lang.import} Data`,
        hideCloseIcon: true,
        beforeClose: () => !busy || committed,
        width: isMobile() ? "92vw" : "560px",
        containerClassName: "data-import",
        content: `<div class="b3-dialog__content">
    <div class="data-import__section ft__breakword">${lang.importDataTip}</div>
    ${plan.conflicts.length ? `<div class="data-import__section">
        <div>${lang.dataImportConflicts}</div>
        <div class="data-import__list ft__breakword" tabindex="0">${plan.conflicts.map(escapeHtml).join("<br>")}</div>
        <label class="data-import__mode"><input type="radio" name="data-import-mode" value="skip" checked>
            <span>${lang.dataImportSkip}</span></label>
        <label class="data-import__mode"><input type="radio" name="data-import-mode" value="overwrite">
            <span>${lang.dataImportOverwrite}</span></label>
    </div>` : ""}
    <label class="data-import__section data-import__password" data-type="password-label">${lang.dataImportMasterPassword}
        <input class="b3-text-field fn__block" type="password" data-type="password" autocomplete="off">
        <span class="b3-label__text fn__block">${lang.dataImportPasswordTip}</span>
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${lang.cancel}</button>
    <div class="fn__space"></div><button class="b3-button b3-button--text" data-type="import">${lang.import}</button>
</div>`,
        destroyCallback: () => {
            closed = true;
            cancel();
        },
    });
    const password = dialog.element.querySelector<HTMLInputElement>('[data-type="password"]');
    const button = dialog.element.querySelector<HTMLButtonElement>('[data-type="import"]');
    const cancelButton = dialog.element.querySelector<HTMLButtonElement>('[data-type="cancel"]');
    const modes = dialog.element.querySelectorAll<HTMLInputElement>('[name="data-import-mode"]');
    const mode = (): "skip" | "overwrite" =>
        dialog.element.querySelector<HTMLInputElement>('[name="data-import-mode"]:checked')?.value === "overwrite" ? "overwrite" : "skip";
    const update = () => {
        const required = needsDataImportPassword(plan, mode());
        dialog.element.querySelector('[data-type="password-label"]').classList.toggle("fn__none", !required);
        password.required = required;
        password.disabled = busy;
        cancelButton.disabled = busy;
        button.disabled = busy || required && !password.value.trim();
    };
    modes.forEach((item) => item.addEventListener("change", update));
    password.addEventListener("input", update);
    cancelButton.addEventListener("click", () => {
        if (!busy) {
            dialog.destroy();
        }
    });
    button.addEventListener("click", async () => {
        if (busy || button.disabled) {
            return;
        }
        busy = true;
        modes.forEach((item) => item.disabled = true);
        update();
        try {
            const payload: CommitDataImportRequestInput = {id: plan.id, mode: mode()};
            if (needsDataImportPassword(plan, payload.mode)) {
                payload.password = password.value.trim();
            }
            const result = await fetchSyncPost("/api/import/commitDataImport", payload);
            password.value = "";
            if (result.code !== 0) {
                return;
            }
            committed = true;
            dialog.destroy();
            // 先展示跳过清单，用户关闭结果后再刷新，避免自动重载吞掉结果提示。
            const completed = new Dialog({
                title: lang.imported,
                width: isMobile() ? "92vw" : "560px",
                containerClassName: "data-import",
                content: `<div class="b3-dialog__content ft__breakword">${result.data.skipped.length ?
                    `${lang.dataImportSkipped}<div class="fn__hr"></div>${result.data.skipped.map(escapeHtml).join("<br>")}` : lang.imported}</div>
<div class="b3-dialog__action"><button class="b3-button b3-button--text" data-type="confirm">${lang.confirm}</button></div>`,
                destroyCallback: () => {
                    onComplete?.();
                    void fetchSyncPost("/api/ui/reloadUI", {});
                },
            });
            completed.element.querySelector('[data-type="confirm"]').addEventListener("click", () => completed.destroy());
        } catch (error) {
            showMessage(error instanceof Error ? error.message : String(error), 0, "error");
        } finally {
            busy = false;
            password.value = "";
            modes.forEach((item) => item.disabled = false);
            update();
            if (closed) {
                cancel();
            }
        }
    });
    update();
};
