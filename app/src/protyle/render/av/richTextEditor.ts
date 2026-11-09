import {escapeHtml} from "../../../util/escape";
import {MobileDialog} from "../../../dialog/mobileDialog";
import {showMessage} from "../../../dialog/message";
import {isMobile} from "../../../util/functions";
import {callMobileAppShowKeyboard} from "../../../mobile/util/mobileAppUtil";
import {hintRef, hintSlash} from "../../hint/extend";
import {registerBuiltinSlashHint} from "../../hint/builtinSlash";
import {mountProtyleLiteFragment} from "../../lite/fragmentEditor";
import {getDefaultToolbar} from "../../toolbar/defaults";
import {highlightRender} from "../highlightRender";
import {mathRender} from "../mathRender";
import {positionAVRichTextEditor} from "./richTextEditorPosition";
import {getAVData} from "./virtualScroll";
import {resolveAVSelectedCell} from "./selectionState";
import {beginAVEditorSession} from "./editorSession";
import {getAVHostBlockID, getAVHostIdentity} from "./host";
import {AV_CELL_EDITOR_CLOSE_EVENT} from "./cellEditor";
import {updateOutlineCurrentBlock} from "../../util/outlineBlock";
import {focusBlock} from "../../util/selection";
import {isAVContinuousInputKey} from "./continuousInput";
import {configureAVRichTextEditorLute, createAVRichTextEditorLute} from "./richTextEditorLute";
import {
    createAVRichTextValue,
    getAVRichTextBlockDOM,
    getAVRichTextUnsupportedPasteBlocks,
    getAVTextSource,
    sanitizeAVRichTextBlockDOM,
    serializeAVRichTextBlockDOM,
} from "./richText";

const SAFE_SLASH_IDS = new Set([
    "ref",
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "heading5",
    "heading6",
    "list",
    "orderedList",
    "check",
    "quote",
    "code",
    "math",
    "link",
    "bold",
    "italic",
    "underline",
    "strike",
    "mark",
    "sup",
    "sub",
    "inlineCode",
    "kbd",
    "tag",
    "inlineMath",
]);

interface AVRichTextEditorOptions {
    protyle: IProtyle;
    nodeElement: HTMLElement;
    anchorElement: HTMLElement;
    value: IAVCellValue;
    stableCells: import("./selectionState").IAVSelectedCell[];
    onSave: (value: IAVCellValue, nodeElement: HTMLElement,
             stableCells: import("./selectionState").IAVSelectedCell[]) => void | Promise<void>;
    onDestroy?: () => void;
    prepareNextInput?: (anchorElement: HTMLElement) => (() => void) | undefined;
}

interface ActiveEditor {
    finish: (save: boolean) => Promise<void>;
}

let activeEditor: ActiveEditor | undefined;

const prepareHint = (protyle: IProtyle) => {
    if (protyle.hint.element.classList.contains("fn__none")) {
        protyle.hint.element.style.zIndex = (++window.siyuan.zIndex).toString();
    }
};

const hintAVRef = (key: string, protyle: IProtyle, source: THintSource) => {
    prepareHint(protyle);
    return hintRef(key, protyle, source);
};

const hintAVSlash = registerBuiltinSlashHint((key: string, protyle: IProtyle, source: THintSource) => {
    prepareHint(protyle);
    return hintSlash(key, protyle, source).filter((item) => item.id && SAFE_SLASH_IDS.has(item.id));
});

const setPanelPosition = (panelElement: HTMLElement, anchorElement: HTMLElement) => {
    if (isMobile()) {
        return;
    }
    positionAVRichTextEditor(panelElement, anchorElement);
};

export const destroyAVRichTextEditor = (save = false) => {
    void activeEditor?.finish(save);
};

export const openAVRichTextEditor = (options: AVRichTextEditorOptions) => {
    void activeEditor?.finish(false);

    const mobile = isMobile();
    let cleanup = () => {};
    const content = `<div class="av__richtext-editor${mobile ? " av__richtext-editor--sheet" : ""}"${mobile ? "" : ' role="dialog"'}>
    <div class="av__richtext-host"></div>
</div>${mobile ? `<div class="b3-dialog__action">
        <button type="button" class="b3-button b3-button--text" data-type="confirm">${escapeHtml(window.siyuan.languages.confirm)}</button>
    </div>` : ""}`;
    const dialog = mobile ? new MobileDialog({
        title: window.siyuan.languages.text,
        content,
        containerClassName: "mobile-av-richtext-sheet",
        mobileSheet: {beforeClose: () => saveMobile()},
        destroyCallback: () => cleanup(),
    }) : undefined;
    const maskElement = dialog?.element || document.createElement("div");
    if (!mobile) {
        maskElement.className = "av__mask av__richtext-mask";
        maskElement.style.zIndex = (++window.siyuan.zIndex).toString();
        maskElement.innerHTML = content;
        document.body.appendChild(maskElement);
    }
    maskElement.dataset.avBlockId = getAVHostIdentity(options.nodeElement);
    maskElement.dataset.avRichtextEditor = "true";
    // 独立记录详情使用未挂载的编辑器上下文，浮层生命周期跟随实际可见的详情面板。
    const ownerElement = options.nodeElement.closest<HTMLElement>(".protyle-db-row") || options.protyle.element;
    const endEditorSession = beginAVEditorSession(ownerElement);
    const panelElement = mobile ? maskElement.querySelector<HTMLElement>(".av__richtext-editor") :
        maskElement.firstElementChild as HTMLElement;
    const hostElement = panelElement.querySelector<HTMLElement>(".av__richtext-host");
    hostElement.dataset.protyleLiteRender = "safe";
    setPanelPosition(panelElement, options.anchorElement);

    const source = getAVTextSource(options.value);
    const toolbar = getDefaultToolbar(mobile);
    const hint: IProtyleOptions["hint"] = {
        extend: [{key: "((", hint: hintAVRef}, {key: "【【", hint: hintAVRef},
            {key: "（（", hint: hintAVRef}, {key: "[[", hint: hintAVRef},
            {key: "/", hint: hintAVSlash}, {key: "、", hint: hintAVSlash}],
    };
    const fragment = mountProtyleLiteFragment(hostElement, {
        initialBlockHTML: source.kind === "rich" ? getAVRichTextBlockDOM(source.content) : undefined,
        initialPlainText: source.kind === "plain" ? source.content : undefined,
        placeholder: window.siyuan.languages.empty,
        protyleOptions: {
            notebookId: options.protyle.notebookId ||
                options.nodeElement.closest<HTMLElement>(".protyle")?.dataset.notebookId,
            toolbar,
            hint,
        },
        runtimeCapabilities: {
            upload: false,
            websocket: false,
            lute: createAVRichTextEditorLute(),
            lockedOptions: {toolbar, hint},
            pluginExtensions: false,
            customBlockRender: false,
            sanitizeBlockDOM: sanitizeAVRichTextBlockDOM,
            getUnsupportedPasteBlocks: getAVRichTextUnsupportedPasteBlocks,
            restoreLuteMarkdownSyntax: configureAVRichTextEditorLute,
        },
        afterSetContent: (protyle, element) => {
            mathRender(element);
            highlightRender(element);
            protyle.undo.clear();
        },
    });
    // 临时块不在块树中，块引搜索和新建文档使用所属文档及真实载体块的上下文。
    fragment.protyle.block.rootID = options.protyle.block.rootID;
    fragment.protyle.block.parentID = getAVHostBlockID(options.nodeElement);
    fragment.protyle.path = options.protyle.path;
    setPanelPosition(panelElement, options.anchorElement);
    const initialMarkdown = serializeAVRichTextBlockDOM(fragment.getBlockHTML()).markdown;

    let finished = false;
    let finishing = false;
    let cancelled = false;
    let resolveClosed: () => void;
    const whenClosed = new Promise<void>(resolve => {resolveClosed = resolve;});
    const isOwnerConnected = () => {
        if (!ownerElement.isConnected || !options.nodeElement.isConnected) {
            return false;
        }
        if (options.anchorElement.isConnected) {
            return true;
        }
        // 行重渲染后按稳定标识确认编辑目标，避免其他单元格的事务丢弃尚未保存的输入。
        const data = getAVData(options.nodeElement);
        return data && options.stableCells.length > 0 && options.stableCells.every(cell =>
            resolveAVSelectedCell(data, cell)?.column.type === "text");
    };
    const resize = () => {
        if (!options.anchorElement.isConnected) {
            const cell = options.stableCells[0];
            if (cell) {
                const group = cell.groupID ? `.av__body[data-group-id="${cell.groupID}"] ` : "";
                const anchor = options.nodeElement.querySelector<HTMLElement>(
                    `${group}.av__row[data-id="${cell.rowID}"] [data-col-id="${cell.colID}"]`);
                if (anchor) {
                    options.anchorElement = anchor;
                }
            }
        }
        if (options.anchorElement.isConnected) {
            setPanelPosition(panelElement, options.anchorElement);
        }
    };
    window.addEventListener("resize", resize);
    const panelResizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    panelResizeObserver?.observe(panelElement);
    const ownerObserver = new MutationObserver(() => {
        if (!isOwnerConnected()) {
            void finish(false);
        } else if (!options.anchorElement.isConnected) {
            resize();
        }
    });
    ownerObserver.observe(document.body, {childList: true, subtree: true});

    cleanup = () => {
        if (finished) return;
        finished = true;
        ownerObserver.disconnect();
        panelResizeObserver?.disconnect();
        window.removeEventListener("resize", resize);
        fragment.destroy();
        if (!mobile) maskElement.remove();
        if (activeEditor?.finish === finish) activeEditor = undefined;
        endEditorSession();
        resolveClosed();
        options.onDestroy?.();
    };
    const saveContent = async () => {
        await fragment.protyle.wysiwyg.flushPendingInput();
        if (cancelled || !isOwnerConnected()) return;
        const serialized = serializeAVRichTextBlockDOM(fragment.getBlockHTML());
        if (serialized.markdown !== initialMarkdown) {
            await options.onSave(createAVRichTextValue(serialized.markdown, serialized.plainText, options.value),
                options.nodeElement, options.stableCells);
        }
    };
    const saveMobile = async () => {
        panelElement.inert = true;
        try {
            if (!finished) await saveContent();
            return true;
        } catch (error) {
            if (!finished) panelElement.inert = false;
            throw error;
        }
    };
    const finish = async (save: boolean, restoreFocus = false, continueInput?: () => void) => {
        if (!save) {
            cancelled = true;
        }
        if (mobile) {
            if (save) {
                const closed = await dialog.requestClose("confirm");
                if (closed && continueInput) {
                    // 移动端关闭动画结束后才清理编辑会话，下一条输入需等待清理完成。
                    await whenClosed;
                    if (!cancelled && !activeEditor && isOwnerConnected()) continueInput();
                }
            }
            else {
                // 目标失效立即清空敏感编辑内容，不等待关闭动画或未完成的保存。
                cleanup();
                dialog.invalidate();
            }
            return;
        }
        if (finished || finishing) {
            return;
        }
        // 桌面保存期间阻止重复结束，但允许失效标记取消迟到提交。
        finishing = true;
        panelElement.inert = true;
        const active = document.activeElement;
        try {
            if (save) await saveContent();
            const canContinue = !continueInput || document.activeElement === active ||
                document.activeElement === document.body || panelElement.contains(document.activeElement);
            cleanup();
            if (restoreFocus && canContinue && !cancelled && !activeEditor && isOwnerConnected() &&
                options.protyle.wysiwyg.element.contains(options.nodeElement)) {
                focusBlock(options.nodeElement);
                continueInput?.();
            }
        } catch (error) {
            console.error(error);
            if (!finished) panelElement.inert = false;
            if (!finished) showMessage(window.siyuan.languages.settingsPendingSaveError);
        } finally {
            finishing = false;
        }
    };

    activeEditor = {finish};
    maskElement.addEventListener(AV_CELL_EDITOR_CLOSE_EVENT, () => void finish(false));
    maskElement.addEventListener("mousedown", (event) => {
        if (!mobile && event.target === maskElement) {
            void finish(true);
        }
    });
    if (mobile) {
        maskElement.querySelector('[data-type="confirm"]')?.addEventListener("click", () => void finish(true));
    }
    const continueInput = (event: Event, repeat = false) => {
        if (fragment.hintElement.classList.contains("fn__none") &&
            fragment.protyle.toolbar.element.classList.contains("fn__none") &&
            fragment.protyle.toolbar.subElement.classList.contains("fn__none")) {
            const next = options.prepareNextInput?.(options.anchorElement);
            if (next) {
                event.preventDefault();
                event.stopPropagation();
                if (!repeat) void finish(true, true, next);
                return true;
            }
        }
        return false;
    };
    panelElement.addEventListener("beforeinput", (event: InputEvent) => {
        if (mobile && event.cancelable && !event.isComposing && event.inputType === "insertParagraph") {
            continueInput(event);
        }
    }, true);
    panelElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (isAVContinuousInputKey(event, true) && continueInput(event, event.repeat)) return;
        if (event.key === "Escape" && fragment.hintElement.classList.contains("fn__none") &&
            fragment.protyle.toolbar.element.classList.contains("fn__none") &&
            fragment.protyle.toolbar.subElement.classList.contains("fn__none")) {
            event.preventDefault();
            event.stopPropagation();
            void finish(true, true);
        }
    }, true);
    if (mobile) {
        dialog.focusWhenReady(() => {
            fragment.focus(true);
            callMobileAppShowKeyboard();
            return fragment.protyle.wysiwyg.element;
        });
    } else {
        fragment.focus(true);
    }
    // 浮层编辑器自行接管焦点，编辑区收不到块级点击，需在此按所属数据库块同步大纲高亮
    updateOutlineCurrentBlock(options.protyle, options.nodeElement);
    if (!mobile) callMobileAppShowKeyboard();
};
