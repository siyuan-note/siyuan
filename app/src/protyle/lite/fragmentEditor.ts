import {genEmptyElement} from "../../block/util";
import type {App} from "../../index";
import {Constants} from "../../constants";
import {Protyle} from "../index";
import type {ProtyleRuntimeCapabilities} from "../runtimeCapabilities";
import {focusBlock} from "../util/selection";
import {invalidateTrackedRanges} from "../util/trackedRange";

export const PROTYLE_LITE_FRAGMENT_CLASS = "protyle-lite-fragment";
export const PROTYLE_LITE_HINT_OVERLAY_CLASS = "protyle-hint--lite-overlay";

export interface ProtyleLiteFragmentOptions {
    app?: App;
    initialMarkdown?: string;
    initialBlockHTML?: string;
    initialPlainText?: string;
    placeholder?: string;
    emptyClass?: string;
    hintOverlayClass?: string;
    protyleOptions?: Partial<IProtyleOptions>;
    runtimeCapabilities?: ProtyleRuntimeCapabilities;
    onChange?: () => void;
    afterSetContent?: (protyle: IProtyle, element: HTMLElement) => void;
}

export interface ProtyleLiteFragment {
    instance: Protyle;
    protyle: IProtyle;
    wysiwyg: HTMLElement;
    hintElement: HTMLElement;
    clear: () => void;
    destroy: () => void;
    focus: (toEnd?: boolean) => void;
    getBlockHTML: (prepareClone?: (element: HTMLElement) => void) => string;
    getMarkdown: (prepareClone?: (element: HTMLElement) => void) => string;
    getPlainText: (prepareClone?: (element: HTMLElement) => void) => string;
    isEmpty: () => boolean;
    setBlockHTML: (blockHTML: string) => void;
    setMarkdown: (markdown: string) => void;
    setPlainText: (plainText: string) => void;
}

const isEmptyContent = (element: HTMLElement) =>
    (element.textContent || "").replace(new RegExp(Constants.ZWSP, "g"), "").trim() === "";

export const mountProtyleLiteFragment = (host: HTMLElement,
                                         options: ProtyleLiteFragmentOptions = {}): ProtyleLiteFragment => {
    host.classList.add(PROTYLE_LITE_FRAGMENT_CLASS);
    const instance = new Protyle(options.app || window.siyuan.ws.app, host, {
        lite: true,
        blockId: "",
        render: {
            gutter: false,
            breadcrumb: false,
            scroll: false,
            background: false,
            title: false,
        },
        ...options.protyleOptions,
    }, options.runtimeCapabilities);
    const protyle = instance.protyle;
    const wysiwyg = protyle.wysiwyg.element;
    const hintElement = protyle.hint.element;
    hintElement.classList.add(PROTYLE_LITE_HINT_OVERLAY_CLASS);
    if (options.hintOverlayClass) {
        hintElement.classList.add(options.hintOverlayClass);
    }
    document.body.appendChild(hintElement);
    wysiwyg.setAttribute("data-readonly", "false");
    protyle.toolbar.subElement.setAttribute("data-position-boundary", "viewport");

    const updateEmptyState = () => {
        const empty = isEmptyContent(wysiwyg);
        if (options.emptyClass) {
            wysiwyg.classList.toggle(options.emptyClass, empty);
        }
        return empty;
    };
    const afterSetContent = () => {
        options.afterSetContent?.(protyle, wysiwyg);
        updateEmptyState();
    };
    const resetContent = () => {
        invalidateTrackedRanges(protyle);
        wysiwyg.innerHTML = "";
    };
    const setEmptyContent = () => {
        resetContent();
        const emptyElement = genEmptyElement(false, false);
        emptyElement.firstElementChild.classList.add("protyle-wysiwyg--empty");
        if (options.placeholder) {
            emptyElement.firstElementChild.setAttribute("placeholder", options.placeholder);
        }
        wysiwyg.appendChild(emptyElement);
        afterSetContent();
    };
    const setBlockHTML = (blockHTML: string) => {
        if (!blockHTML) {
            setEmptyContent();
            return;
        }
        resetContent();
        wysiwyg.innerHTML = blockHTML;
        afterSetContent();
    };
    const setMarkdown = (markdown: string) => {
        if (!markdown) {
            setEmptyContent();
            return;
        }
        setBlockHTML(protyle.lute.Md2BlockDOM(markdown));
    };
    const setPlainText = (plainText: string) => {
        if (!plainText) {
            setEmptyContent();
            return;
        }
        resetContent();
        plainText.replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
            const blockElement = genEmptyElement(false, false);
            const editElement = blockElement.querySelector<HTMLElement>('[contenteditable="true"]');
            editElement.textContent = line;
            wysiwyg.appendChild(blockElement);
        });
        afterSetContent();
    };

    if (typeof options.initialBlockHTML === "string" && options.initialBlockHTML) {
        setBlockHTML(options.initialBlockHTML);
    } else if (typeof options.initialMarkdown === "string" && options.initialMarkdown) {
        setMarkdown(options.initialMarkdown);
    } else if (typeof options.initialPlainText === "string" && options.initialPlainText) {
        setPlainText(options.initialPlainText);
    } else {
        setEmptyContent();
    }

    const contentObserver = new MutationObserver(() => {
        updateEmptyState();
        options.onChange?.();
    });
    contentObserver.observe(wysiwyg, {childList: true, characterData: true, subtree: true});

    const cloneContent = (prepareClone?: (element: HTMLElement) => void) => {
        const clone = wysiwyg.cloneNode(true) as HTMLElement;
        prepareClone?.(clone);
        return clone;
    };

    return {
        instance,
        protyle,
        wysiwyg,
        hintElement,
        clear: () => {
            setEmptyContent();
            protyle.undo.clear();
        },
        destroy: () => {
            contentObserver.disconnect();
            instance.destroy();
            hintElement.remove();
            host.classList.remove(PROTYLE_LITE_FRAGMENT_CLASS);
        },
        focus: (toEnd = false) => {
            if (!toEnd || !focusBlock(wysiwyg.lastElementChild, wysiwyg, false)) {
                instance.focus();
            }
        },
        getBlockHTML: (prepareClone) => cloneContent(prepareClone).innerHTML,
        getMarkdown: (prepareClone) => protyle.lute.BlockDOM2StdMd(cloneContent(prepareClone).innerHTML).trim(),
        getPlainText: (prepareClone) => protyle.lute.BlockDOM2Content(cloneContent(prepareClone).innerHTML).trim(),
        isEmpty: () => isEmptyContent(wysiwyg),
        setBlockHTML,
        setMarkdown,
        setPlainText,
    };
};
