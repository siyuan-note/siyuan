import {Constants} from "../../constants";
import {Protyle} from "../../protyle";
import {fetchSyncPost} from "../../util/fetch";
import {showMessage} from "../../dialog/message";
import {escapeHtml} from "../../util/escape";
import {bindBottomSheetDialog} from "./bindBottomSheetDialog";
import {getMobileEditorDialog, type MobileEditorDialog} from "./MobileEditorDialog";
import {activeBlur} from "./keyboardToolbar";
import {flushMobileSecondaryEditor, registerMobileSecondaryEditor} from "./secondaryEditors";
import {getVisibleViewportBounds} from "./visibleViewport";
import {getDocByScroll, saveScroll} from "../../protyle/scroll/saveScroll";
import {registerEditorSave} from "../../protyle/util/editorSave";
import {hasAVEditorSession} from "../../protyle/render/av/editorSession";
import {closeAVCellEditor} from "../../protyle/render/av/cellEditor";

interface ReferenceSheet {
    dialog: MobileEditorDialog;
    editor: Protyle;
    source: IProtyle;
    sourceRootID: string;
    sourceNotebookID: string;
    sourceBlockID: string;
    targetRootID: string;
    scrollTop: number;
    scrollLeft: number;
    disposeEditor: () => void;
    flush: () => Promise<void>;
    replace: () => Promise<void>;
}

let current: ReferenceSheet;
let openVersion = 0;

export const invalidateMobileReferenceOpen = () => {
    openVersion++;
};

export const removeMobileReferenceSheet = (options: {notebookId?: string, rootIDs?: string[]}) => {
    if (!options.notebookId && !options.rootIDs?.length) {
        return;
    }
    // 失效尚未完成的加载，避免锁定后迟到的响应重新显示内容。
    openVersion++;
    const sheet = current;
    if (!sheet || !((options.notebookId && [sheet.sourceNotebookID, sheet.editor.protyle.notebookId]
        .includes(options.notebookId)) || options.rootIDs?.some(id =>
        [sheet.sourceRootID, sheet.targetRootID, sheet.editor.protyle.block.rootID].includes(id)))) {
        return;
    }
    current = undefined;
    closeAVCellEditor(sheet.editor.protyle.element, false);
    sheet.disposeEditor();
    sheet.dialog.element.querySelector(".b3-dialog__body").replaceChildren();
    sheet.dialog.discard();
};

export const refreshMobileReferenceSheet = (rootIDs: string[], updateReadonly: boolean) => {
    const sheet = current;
    if (!sheet || !rootIDs.includes(sheet.editor.protyle.block.rootID)) {
        return;
    }
    void sheet.flush().then(() => {
        if (current !== sheet || sheet.dialog.element.hasAttribute("inert")) {
            return;
        }
        getDocByScroll({
            protyle: sheet.editor.protyle,
            scrollAttr: saveScroll(sheet.editor.protyle, true) as IScrollAttr || {
                rootId: sheet.targetRootID,
                zoomInId: sheet.editor.protyle.block.showAll ? sheet.editor.protyle.block.id : undefined,
                scrollTop: sheet.editor.protyle.contentElement.scrollTop,
            },
            updateReadonly,
            isValid: () => current === sheet && !sheet.dialog.element.hasAttribute("inert"),
        });
    }).catch(error => showMessage(escapeHtml(String(error))));
};

export const openMobileReference = async (protyle: IProtyle, blockId: string) => {
    const version = ++openVersion;
    // 嵌套引用替换当前抽屉，始终保留最初的文档及阅读位置。
    const previous = current;
    const origin = previous?.editor.protyle === protyle ? previous : undefined;
    const source = origin?.source || protyle;
    const sourceRootID = origin?.sourceRootID || source.block.rootID;
    const sourceNotebookID = origin?.sourceNotebookID || source.notebookId;
    const sourceBlockID = origin?.sourceBlockID || source.block.id;
    const scrollTop = origin?.scrollTop ?? source.contentElement.scrollTop;
    const scrollLeft = origin?.scrollLeft ?? source.contentElement.scrollLeft;
    const isValid = () => version === openVersion && source.element.isConnected &&
        source.block.rootID === sourceRootID && source.notebookId === sourceNotebookID && source.block.id === sourceBlockID;
    window.siyuan.menus.menu.remove();
    activeBlur(true);
    try {
        const response = await fetchSyncPost("/api/block/getBlockInfo", {id: blockId});
        if (!isValid() || response.code !== 0 || !response.data?.rootID) {
            if (isValid() && response.code > 0) {
                showMessage(response.msg || window.siyuan.languages.refExpired);
            }
            return;
        }
        try {
            await previous?.replace();
        } catch (error) {
            console.error(error);
            return;
        }
        if (!isValid()) {
            return;
        }
        let disposed = false;
        let replacing = false;
        const restoreScroll = () => {
            if (source.element.isConnected && source.block.rootID === sourceRootID &&
                source.notebookId === sourceNotebookID && source.block.id === sourceBlockID) {
                source.contentElement.scrollTop = scrollTop;
                source.contentElement.scrollLeft = scrollLeft;
            }
        };
        const MobileEditorDialog = getMobileEditorDialog();
        const dialog = new MobileEditorDialog({
            title: window.siyuan.languages.viewRefContent,
            content: '<div class="mobile-reference-editor fn__flex-1"></div>',
            width: "100vw",
            height: "60%",
            hideCloseIcon: true,
            containerClassName: "mobile-reference-sheet",
            destroyCallback: () => {
                disposeSheet();
                window.removeEventListener("resize", resize);
                sheet.disposeEditor();
                if (current === sheet) {
                    current = undefined;
                }
                restoreScroll();
            },
        });
        dialog.element.classList.add("mobile-reference-dialog");
        const editor = new Protyle(protyle.app, dialog.element.querySelector(".mobile-reference-editor"), {
            blockId,
            rootId: response.data.rootID,
            notebookId: response.data.box,
            databaseAttr: true,
            action: [blockId === response.data.rootID ? Constants.CB_GET_CONTEXT : Constants.CB_GET_ALL],
            render: {
                scroll: true,
                gutter: true,
                breadcrumb: false,
                title: blockId === response.data.rootID,
                background: false,
            },
            typewriterMode: false,
        });
        const saveGuard = registerEditorSave(editor.protyle);
        const childWaiters = new Set<() => void>();
        const waitForChildEditor = () => {
            if (disposed || !hasAVEditorSession(editor.protyle.element)) {
                return Promise.resolve();
            }
            // 富文本单元格使用自己的确认按钮，保持浮层可操作，等待其提交或取消后再关闭抽屉。
            return new Promise<void>(resolve => {
                const finish = () => {
                    if (!disposed && hasAVEditorSession(editor.protyle.element)) {
                        return;
                    }
                    editor.protyle.element.removeEventListener("av-editor-close", finish);
                    childWaiters.delete(finish);
                    resolve();
                };
                childWaiters.add(finish);
                editor.protyle.element.addEventListener("av-editor-close", finish);
            });
        };
        const sheet: ReferenceSheet = {dialog, editor, source, sourceRootID, sourceNotebookID, sourceBlockID,
            targetRootID: response.data.rootID, scrollTop, scrollLeft,
            replace: async () => {
                replacing = true;
                try {
                    await dialog.close();
                } finally {
                    replacing = false;
                }
            },
            flush: async () => {
                await waitForChildEditor();
                if (disposed) {
                    return;
                }
                closeAVCellEditor(editor.protyle.element);
                editor.protyle.title?.flushPendingInput();
                await flushMobileSecondaryEditor(editor);
                await saveGuard.flush();
            },
            disposeEditor: () => {
                if (!disposed) {
                    disposed = true;
                    childWaiters.forEach(finish => finish());
                    editor.protyle.title?.cancelPendingInput();
                    saveGuard.dispose();
                    editor.destroy();
                }
            }};
        current = sheet;
        registerMobileSecondaryEditor(editor, () => removeMobileReferenceSheet({rootIDs: [sheet.targetRootID]}));
        dialog.beforeClose = async () => {
            if (!replacing) {
                invalidateMobileReferenceOpen();
            }
            await waitForChildEditor();
            if (disposed) {
                return;
            }
            if (editor.isUploading()) {
                throw new Error(window.siyuan.languages.uploading);
            }
            if (dialog.element.contains(document.activeElement)) {
                activeBlur(true);
            }
            dialog.element.setAttribute("inert", "");
            try {
                await sheet.flush();
            } catch (error) {
                dialog.element.removeAttribute("inert");
                throw error;
            }
            sheet.disposeEditor();
            if (current === sheet) {
                current = undefined;
            }
        };
        dialog.register();
        const resize = () => {
            const viewport = getVisibleViewportBounds();
            const container = dialog.element.querySelector<HTMLElement>(".b3-dialog");
            container.style.top = `${viewport.top}px`;
            container.style.height = `${viewport.bottom - viewport.top}px`;
            dialog.element.classList.toggle("mobile-reference-dialog--compact", viewport.bottom - viewport.top < 400);
            restoreScroll();
        };
        const disposeSheet = bindBottomSheetDialog(dialog, () => dialog.close(), resize);
        window.addEventListener("resize", resize);
        resize();
    } catch (error) {
        showMessage(escapeHtml(String(error)));
    }
};
