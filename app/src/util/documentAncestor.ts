import {confirmDialog} from "../dialog/confirmDialog";
import {escapeHtml} from "./escape";
import {movePathTo} from "./pathName";
import {documentParentID} from "./documentCreate";
import {fetchSyncPost} from "./fetch";
import {showMessage} from "../dialog/message";
import type {Dialog} from "../dialog";
import type {DocumentAncestorAmbiguity, DocumentPath} from "../types/api";

/** 默认选中第一个候选，确认后用于当前创建计划，关闭对话框即取消。 */
export const selectDocumentAncestor = (notebook: string, ambiguity: DocumentAncestorAmbiguity, lifecycle: {
    open: (dialog: Dialog) => void;
    close: (dialog: Dialog) => void;
    valid: () => boolean;
}) => new Promise<DocumentPath | undefined>(resolve => {
    let current: Dialog;
    let settled = false;
    const finish = (document?: DocumentPath) => {
        if (settled) {
            return;
        }
        settled = true;
        if (current) {
            lifecycle.close(current);
        }
        resolve(document);
    };
    const chooseOther = () => {
        lifecycle.close(current);
        let submitted = false;
        current = movePathTo({
            title: window.siyuan.languages.documentAncestorAmbiguous,
            flashcard: false,
            sourceNotebookIds: [notebook],
            validate: (paths, notebooks) => notebooks[0] === notebook && !!documentParentID(paths[0]) &&
                documentParentID(paths[0]) !== notebook,
            restoreFocus: () => {
                if (!submitted) {
                    finish();
                }
            },
            cb: (paths) => {
                submitted = true;
                if (!lifecycle.valid()) {
                    finish();
                    return;
                }
                void fetchSyncPost("/api/filetree/getDocPaths", {notebook, ids: [documentParentID(paths[0])]}, undefined, false)
                    .then(response => {
                        if (!lifecycle.valid()) {
                            finish();
                            return;
                        }
                        if (response.code !== 0) {
                            showMessage(escapeHtml(response.msg), 0, "error");
                        }
                        finish(response.code === 0 && response.data && "documents" in response.data ?
                            response.data.documents[0] : undefined);
                    })
                    .catch(error => {
                        if (lifecycle.valid()) {
                            showMessage(escapeHtml(error.message), 0, "error");
                        }
                        finish();
                    });
            },
        });
        if (current) {
            lifecycle.open(current);
        } else {
            finish();
        }
    };
    current = confirmDialog(window.siyuan.languages.newFile,
        `<label>${escapeHtml(window.siyuan.languages.documentAncestorAmbiguous)}
<div class="fn__hr"></div><span class="ft__breakword">${escapeHtml(ambiguity.title)}</span>
<div class="fn__hr"></div><select class="b3-select fn__block" data-ancestor-select>
${ambiguity.candidates.map((candidate, index) =>
            `<option value="${index}">${escapeHtml(candidate.displayPath)} [${escapeHtml(candidate.id)}]</option>`).join("")}
</select></label>`, () => {
            const value = current.element.querySelector<HTMLSelectElement>("[data-ancestor-select]").value;
            finish(value === "" ? undefined : ambiguity.candidates[Number(value)]);
        }, () => finish(), false, {
            label: window.siyuan.languages.documentAncestorMore,
            callback: chooseOther,
        });
    lifecycle.open(current);
    const select = current.element.querySelector<HTMLSelectElement>("[data-ancestor-select]");
    const confirm = current.element.querySelector<HTMLButtonElement>("#confirmDialogConfirmBtn");
    select.value = ambiguity.candidates.length ? "0" : "";
    confirm.disabled = ambiguity.candidates.length === 0;
    select.focus();
});
