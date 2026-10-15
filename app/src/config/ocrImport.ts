import {Dialog} from "../dialog";
import {showMessage} from "../dialog/message";
import {fetchSyncPost} from "../util/fetch";
import {ContractFormData} from "../util/contractFormData";
import {escapeAttr, escapeHtml} from "../util/escape";
import {isMobile} from "../util/functions";

interface OCRModelFile {
    id: string;
    title: string;
    suffix: string;
}

/** 自定义模型导入所需的 4 个文件，顺序与内核导入参数一致 */
const getOCRModelFiles = (): OCRModelFile[] => [
    {id: "detector", title: window.siyuan.languages.ocrDetector, suffix: "onnx"},
    {id: "detectorConfig", title: `${window.siyuan.languages.ocrDetector} - YAML`, suffix: "yml,yaml"},
    {id: "recognizer", title: window.siyuan.languages.ocrRecognizer, suffix: "onnx"},
    {id: "recognizerConfig", title: `${window.siyuan.languages.ocrRecognizer} - YAML`, suffix: "yml,yaml"},
];

const genFileRowHtml = (file: OCRModelFile, label: string, first: boolean): string =>
    `${first ? "" : '<div class="fn__hr"></div>'}<div class="fn__block">
    <div id="${escapeAttr(file.id)}Label" class="b3-label__text">${escapeHtml(file.title)}</div>
    <div class="fn__hr--small"></div>
    <div class="fn__flex">
        <button type="button" class="b3-button b3-button--outline fn__flex-center" data-ocr-file="${escapeAttr(file.id)}" aria-describedby="${escapeAttr(file.id)}Label">${escapeHtml(label)}</button>
        <span class="fn__space"></span>
        <span id="${escapeAttr(file.id)}Name" class="fn__flex-1 fn__flex-center fn__ellipsis" aria-live="polite"></span>
    </div>
    <input id="${escapeAttr(file.id)}" class="fn__none" type="file" accept="${file.suffix.split(",").map(suffix => `.${suffix}`).join(",")}">
</div>`;

/**
 * 打开导入自定义 OCR 模型的对话框，选择齐 4 个文件后才能提交。
 * 导入成功后关闭对话框并回调 `onImported` 刷新模型列表。
 */
export const openOCRImportModelsDialog = (options: {
    signal: AbortSignal,
    onImported: () => void,
    onClosed?: () => void,
}) => {
    const languages = window.siyuan.languages;
    const files = getOCRModelFiles();
    let busy = false;
    let closed = false;
    const dialog = new Dialog({
        title: languages.ocrImportModelsTitle,
        width: isMobile() ? "92vw" : "520px",
        destroyCallback: () => {
            closed = true;
            options.onClosed?.();
        },
        content: `<div class="b3-dialog__content">${files.map((file, index) => genFileRowHtml(file, languages.chooseFile, index === 0)).join("")}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" id="ocrImportCancel">${escapeHtml(languages.cancel)}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" id="ocrImportConfirm" disabled>${escapeHtml(languages.import)}</button>
</div>`,
    });
    const fileInput = (file: OCRModelFile) => dialog.element.querySelector<HTMLInputElement>(`#${file.id}`);
    const importButton = dialog.element.querySelector<HTMLButtonElement>("#ocrImportConfirm");
    const update = () => {
        files.forEach(file => {
            const name = dialog.element.querySelector<HTMLElement>(`#${file.id}Name`);
            name.textContent = fileInput(file).files?.[0]?.name || "";
            name.title = name.textContent;
        });
        importButton.disabled = busy || files.some(file => !fileInput(file).files?.length);
    };
    dialog.element.querySelector("#ocrImportCancel").addEventListener("click", () => dialog.destroy());
    dialog.element.addEventListener("change", (event) => {
        if (files.some(file => file.id === (event.target as HTMLInputElement).id)) {
            update();
        }
    });
    dialog.element.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-ocr-file]");
        const file = button && files.find(item => item.id === button.dataset.ocrFile);
        if (file && !busy) {
            fileInput(file).click();
        }
    });
    importButton.addEventListener("click", async () => {
        if (busy || importButton.disabled) {
            return;
        }
        busy = true;
        update();
        let imported = false;
        try {
            const response = await fetchSyncPost("/api/asset/importOCRModels", new ContractFormData({
                detector: fileInput(files[0]).files[0],
                detectorConfig: fileInput(files[1]).files[0],
                recognizer: fileInput(files[2]).files[0],
                recognizerConfig: fileInput(files[3]).files[0],
            }), undefined, true, options.signal);
            imported = response.code === 0;
        } catch (error) {
            if (!closed && !options.signal.aborted && error.name !== "AbortError") {
                showMessage(error.message);
            }
        } finally {
            busy = false;
            if (imported && !closed && !options.signal.aborted) {
                showMessage(languages.imported);
                dialog.destroy();
                options.onImported();
            } else if (!closed) {
                update();
            }
        }
    });
    update();
    return dialog;
};
