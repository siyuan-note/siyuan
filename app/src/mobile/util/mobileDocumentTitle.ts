import {renderDocumentTitlePreview} from "../../protyle/header/documentTitlePreview";
import {getDocDisplayName} from "../../util/pathName";
import {setTitleAutoDirection} from "../../protyle/render/autoDirection";

export const updateMobileDocumentTitle = (protyle: IProtyle) => {
    if (window.siyuan.mobile.editor?.protyle !== protyle) return;
    const input = document.getElementById("toolbarName") as HTMLInputElement;
    const label = document.getElementById("toolbarNameReadonly");
    if (!input || !label) return;
    const id = protyle.block.rootID;
    const notebook = protyle.notebookId;
    const editor = label.querySelector<HTMLElement>(".mobile-document-title-editor");
    if (editor?.dataset.documentTitleId === id && editor.dataset.notebookId === notebook) return;
    if (id === notebook) {
        label.textContent = input.value;
        return;
    }
    let preview = label.firstElementChild as HTMLElement;
    if (!preview || preview.dataset.documentTitleId !== id || preview.dataset.notebookId !== notebook) {
        preview = document.createElement("span");
        preview.dataset.documentTitleId = id;
        preview.dataset.notebookId = notebook;
        preview.textContent = getDocDisplayName(input.value, input.value === "");
        label.replaceChildren(preview);
    }
    setTitleAutoDirection(label, window.siyuan.config.editor.autoDirection);
    renderDocumentTitlePreview(preview, id, notebook, () => window.siyuan.mobile.editor?.protyle === protyle &&
        protyle.block.rootID === id && protyle.notebookId === notebook);
};
