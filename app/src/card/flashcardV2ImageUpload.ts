import {genAssetHTML} from "../asset/renderAssets";
import {genEmptyElement} from "../block/util";
import {Constants} from "../constants";
import {Dialog} from "../dialog";
import {showMessage} from "../dialog/message";
import {isProtyleUploadDisabled} from "../protyle/runtimeCapabilities";
import {uploadFiles} from "../protyle/upload";
import {captureUploadDocument} from "../protyle/upload/insertPosition";
import {getCompleteAssetUploadPathsByInput} from "../protyle/upload/uploadResult";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {transaction} from "../protyle/wysiwyg/transaction";
import {isMobile} from "../util/functions";
import {isBrowserRenderableImagePath} from "../util/imageURL";
import {isEncryptedBox} from "../util/pathName";
import {captureFlashcardSlashCancellation} from "./flashcardV2Authoring";
import {createFlashcardFromImage} from "./flashcardV2ImageEntry";

const imageExtension = (path: string) => {
    const filename = path.split(/[?#]/, 1)[0];
    const extensionAt = filename.lastIndexOf(".");
    return extensionAt < 0 ? "" : filename.slice(extensionAt).toLowerCase();
};

export const openFlashcardV2ImageUpload = (protyle: IProtyle, block: HTMLElement, range: Range) => {
    const editable = getContenteditableElement(block, range.startContainer);
    const rootID = protyle.block.rootID;
    const notebookID = protyle.notebookId;
    const available = () => !!rootID && protyle.block.rootID === rootID && protyle.notebookId === notebookID &&
        protyle.element.isConnected && !protyle.disabled && !protyle.lite && !window.siyuan.config.readonly &&
        !window.siyuan.isPublish && !isEncryptedBox(notebookID) && !isProtyleUploadDisabled(protyle);
    if (!available() || block.dataset.type !== "NodeParagraph" || block.closest('[data-type="NodeBlockQueryEmbed"]') ||
        !editable?.contains(range.startContainer) || !editable.contains(range.endContainer)) {
        return;
    }
    const beforeContent = editable.innerHTML;
    const remaining = editable.cloneNode(false) as HTMLElement;
    const before = document.createRange();
    before.selectNodeContents(editable);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(editable);
    after.setStart(range.endContainer, range.endOffset);
    remaining.append(before.cloneContents(), after.cloneContents());
    const replaceParagraph = !remaining.textContent.replaceAll(Constants.ZWSP, "").trim() &&
        !remaining.querySelector("img, audio, video, iframe, [data-type~=inline-math], [data-type~=block-ref]");
    const targetAvailable = () => available() && protyle.wysiwyg.element.contains(block) &&
        block.contains(editable) && editable.innerHTML === beforeContent;
    const cancelCommand = captureFlashcardSlashCancellation(protyle, block, range);
    const lang = window.siyuan.languages;
    let pending = false;
    let closed = false;
    let inserting = false;
    let committed = false;
    const dialog = new Dialog({
        title: lang.flashcardImageOcclusion,
        width: isMobile() ? "92vw" : "420px",
        content: `<div class="b3-dialog__content">
    <button type="button" class="b3-button b3-button--outline" data-image-upload-picker><svg><use xlink:href="#iconUpload"></use></svg>${lang.upload}</button>
    <input type="file" class="fn__none" accept="image/*">
    <div class="b3-label__text" role="status">${lang.flashcardImageUploadHint}</div>
</div>
<div class="b3-dialog__action"><button type="button" class="b3-button b3-button--cancel">${lang.cancel}</button></div>`,
        destroyCallback: () => {
            closed = true;
            if (!inserting && !committed) {
                cancelCommand();
            }
        },
    });
    const panel = dialog.element.querySelector<HTMLElement>(".b3-dialog__content");
    const picker = panel.querySelector<HTMLButtonElement>("[data-image-upload-picker]");
    const input = panel.querySelector<HTMLInputElement>("input");
    input.accept = Constants.SIYUAN_ASSETS_IMAGE.join(",");
    const status = panel.querySelector("[role=status]");
    const isCurrent = () => !closed && dialog.element.isConnected && dialog.element.dataset.dialogClosing !== "true";
    const upload = (files: FileList, source: "file-picker" | "drop") => {
        if (pending || !isCurrent() || !files.length) {
            return;
        }
        if (!targetAvailable()) {
            showMessage(lang.uploadInsertTargetUnavailable);
            return;
        }
        if (files.length !== 1 || !Constants.SIYUAN_ASSETS_IMAGE.includes(imageExtension(files[0].name))) {
            status.textContent = lang.flashcardImageUploadHint;
            showMessage(lang.flashcardImageUploadHint);
            return;
        }
        const file = files[0];
        const reset = () => {
            pending = false;
            inserting = false;
            picker.disabled = false;
            status.textContent = lang.flashcardImageUploadHint;
        };
        pending = true;
        picker.disabled = true;
        status.textContent = lang.uploading;
        uploadFiles(protyle, [file], input, (_response, result) => {
            if (!isCurrent()) { return; }
            if (!targetAvailable()) {
                showMessage(lang.uploadInsertTargetUnavailable);
                return;
            }
            const asset = getCompleteAssetUploadPathsByInput(1, result)?.[0];
            const extension = asset ? imageExtension(asset) : "";
            if (!asset?.startsWith("assets/") || /[?&]box=/.test(asset) || !Constants.SIYUAN_ASSETS_IMAGE.includes(extension) ||
                !isBrowserRenderableImagePath(asset)) {
                showMessage(lang.uploadError);
                return;
            }
            const original = block.outerHTML;
            const id = block.dataset.nodeId;
            const updated = block.cloneNode(true) as HTMLElement;
            const imageBlock = replaceParagraph ? updated : genEmptyElement(false, false);
            const imageID = imageBlock.dataset.nodeId;
            const filename = file.name;
            if (!replaceParagraph) {
                getContenteditableElement(updated).replaceChildren(...remaining.cloneNode(true).childNodes);
            }
            getContenteditableElement(imageBlock).innerHTML = genAssetHTML(extension, asset, filename, filename);
            const changes: IOperation[] = [{action: "update", id, data: updated.outerHTML}];
            const undo: IOperation[] = [{action: "update", id, data: original}];
            if (!replaceParagraph) {
                changes.push({action: "insert", id: imageID, previousID: id, data: imageBlock.outerHTML});
                undo.unshift({action: "delete", id: imageID});
            }
            // 事务会保留选区所在块的旧 DOM；这里尚未修改原块，需要由事务更新并插入图片。
            const selection = window.getSelection();
            if (selection && block.contains(selection.anchorNode) && block.contains(selection.focusNode)) {
                selection.removeAllRanges();
            }
            inserting = true;
            void Promise.resolve(transaction(protyle, changes, undo, {
                awaitResponse: true,
                callback: () => {
                    committed = true;
                    if (!isCurrent() || !available()) { return; }
                    const inserted = protyle.wysiwyg.element.querySelector<HTMLImageElement>(
                        `[data-node-id="${CSS.escape(imageID)}"] img[data-src="${CSS.escape(asset)}"]`);
                    if (inserted) {
                        dialog.destroy();
                        createFlashcardFromImage(inserted);
                    } else {
                        showMessage(lang.uploadInsertTargetUnavailable);
                    }
                },
            })).catch(error => {
                console.error("Flashcard image insertion failed", error);
                if (isCurrent()) { showMessage(lang.uploadError); }
            }).finally(reset);
        }, () => {
            if (!inserting) { reset(); }
        }, {
            document: captureUploadDocument(protyle),
            source,
            requiredFileCount: 1,
            allowedInputKinds: ["files"],
        });
    };
    picker.addEventListener("click", () => input.click());
    input.addEventListener("change", () => upload(input.files, "file-picker"));
    panel.addEventListener("dragover", event => {
        if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
        }
    });
    panel.addEventListener("drop", event => {
        event.preventDefault();
        event.stopPropagation();
        upload(event.dataTransfer.files, "drop");
    });
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
};
