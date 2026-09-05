import {escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {callMobileAppShowKeyboard} from "../../../mobile/util/mobileAppUtil";
import {hintRef, hintSlash} from "../../hint/extend";
import {mountProtyleLiteFragment} from "../../lite/fragmentEditor";
import {highlightRender} from "../highlightRender";
import {mathRender} from "../mathRender";
import {positionAVRichTextEditor} from "./richTextEditorPosition";
import {
    configureAVRichTextLute,
    createAVRichTextValue,
    getAVRichTextLute,
    getAVRichTextBlockDOM,
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

const hintAVSlash = (key: string, protyle: IProtyle, source: THintSource) => {
    prepareHint(protyle);
    return hintSlash(key, protyle, source).filter((item) => item.id && SAFE_SLASH_IDS.has(item.id));
};

const setPanelPosition = (panelElement: HTMLElement, anchorElement: HTMLElement) => {
    if (isMobile()) {
        panelElement.classList.add("av__richtext-editor--mobile");
        panelElement.removeAttribute("style");
        return;
    }
    positionAVRichTextEditor(panelElement, anchorElement);
};

export const destroyAVRichTextEditor = (save = false) => {
    void activeEditor?.finish(save);
};

export const openAVRichTextEditor = (options: AVRichTextEditorOptions) => {
    void activeEditor?.finish(false);

    const maskElement = document.createElement("div");
    maskElement.className = "av__mask av__richtext-mask";
    maskElement.style.zIndex = (++window.siyuan.zIndex).toString();
    maskElement.innerHTML = `<div class="av__richtext-editor" role="dialog">
    <div class="av__richtext-host"></div>
    <div class="av__richtext-actions">
        <button type="button" class="b3-button b3-button--cancel" data-type="cancel">${escapeHtml(window.siyuan.languages.cancel)}</button>
        <button type="button" class="b3-button b3-button--text" data-type="save">${escapeHtml(window.siyuan.languages.save)}</button>
    </div>
</div>`;
    document.body.appendChild(maskElement);
    const panelElement = maskElement.firstElementChild as HTMLElement;
    const hostElement = panelElement.querySelector<HTMLElement>(".av__richtext-host");
    hostElement.dataset.protyleLiteRender = "safe";
    setPanelPosition(panelElement, options.anchorElement);

    const source = getAVTextSource(options.value);
    const toolbar: IProtyleOptions["toolbar"] = [
        "block-ref", "a", "|", "text", "strong", "em", "u", "s", "mark", "sup", "sub",
        "code", "kbd", "tag", "inline-math", "inline-memo", "clear",
    ];
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
            lute: getAVRichTextLute(),
            lockedOptions: {toolbar, hint},
            pluginExtensions: false,
            customBlockRender: false,
            sanitizeBlockDOM: sanitizeAVRichTextBlockDOM,
            restoreLuteMarkdownSyntax: configureAVRichTextLute,
        },
        afterSetContent: (protyle, element) => {
            mathRender(element);
            highlightRender(element);
            protyle.undo.clear();
        },
    });
    setPanelPosition(panelElement, options.anchorElement);
    const initialMarkdown = serializeAVRichTextBlockDOM(fragment.getBlockHTML()).markdown;

    let finished = false;
    let cancelled = false;
    const isOwnerConnected = () => options.protyle.element.isConnected && options.nodeElement.isConnected &&
        options.anchorElement.isConnected;
    const resize = () => setPanelPosition(panelElement, options.anchorElement);
    window.addEventListener("resize", resize);
    const panelResizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    panelResizeObserver?.observe(panelElement);
    const ownerObserver = new MutationObserver(() => {
        if (!isOwnerConnected()) {
            void finish(false);
        }
    });
    ownerObserver.observe(document.body, {childList: true, subtree: true});

    const finish = async (save: boolean) => {
        if (!save) {
            cancelled = true;
        }
        if (finished) {
            return;
        }
        finished = true;
        try {
            if (save) {
                await fragment.protyle.wysiwyg.flushPendingInput();
                if (cancelled || !isOwnerConnected()) {
                    return;
                }
                const serialized = serializeAVRichTextBlockDOM(fragment.getBlockHTML());
                if (serialized.markdown !== initialMarkdown) {
                    await options.onSave(createAVRichTextValue(serialized.markdown, serialized.plainText, options.value),
                        options.nodeElement, options.stableCells);
                }
            }
        } finally {
            ownerObserver.disconnect();
            panelResizeObserver?.disconnect();
            window.removeEventListener("resize", resize);
            fragment.destroy();
            maskElement.remove();
            if (activeEditor?.finish === finish) {
                activeEditor = undefined;
            }
            options.onDestroy?.();
        }
    };

    activeEditor = {finish};
    maskElement.addEventListener("mousedown", (event) => {
        if (event.target === maskElement) {
            void finish(true);
        }
    });
    panelElement.querySelector('[data-type="cancel"]').addEventListener("click", () => void finish(false));
    panelElement.querySelector('[data-type="save"]').addEventListener("click", () => void finish(true));
    panelElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape" && fragment.hintElement.classList.contains("fn__none") &&
            fragment.protyle.toolbar.element.classList.contains("fn__none") &&
            fragment.protyle.toolbar.subElement.classList.contains("fn__none")) {
            event.preventDefault();
            event.stopPropagation();
            void finish(false);
        }
    }, true);
    fragment.focus(true);
    callMobileAppShowKeyboard();
};
