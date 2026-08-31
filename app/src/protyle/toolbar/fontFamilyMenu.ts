import {Menu} from "../../plugin/Menu";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {getUniqueFontFamilies, IFontItem, loadSystemFonts} from "../../util/systemFont";
import {upDownHint} from "../../util/upDownHint";
import {Constants} from "../../constants";
import {getBlockRanges} from "../util/selection";
import {hasClosestBlock} from "../util/hasClosest";
import {
    FONT_FAMILY_EXCLUDED_BLOCK_TYPES,
    getInlineFontFamilySelection,
    getInlineFontFamilyStyle,
    hasInlineFontFamilyExcludedType,
} from "./fontFamilyCore";

export interface IInlineFontFamilyState {
    disabled: boolean;
    family?: string;
    mixed: boolean;
}

interface IFontFamilyPickerOptions extends IInlineFontFamilyState {
    isOpenValid?: () => boolean;
    onBack?: () => void;
    onClose?: () => void;
    onInteraction?: () => void;
    onSelect: (family?: string) => void;
}

const getNodeFontFamily = (node: Node, root: HTMLElement) => {
    let element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
    let fontFamily: string | undefined;
    while (element && root.contains(element)) {
        const types = (element.getAttribute("data-type") || "").split(" ").filter(Boolean);
        if (hasInlineFontFamilyExcludedType(types)) {
            return {excluded: true, fontFamily: undefined};
        }
        const ownFontFamily = element.style.fontFamily;
        if (!fontFamily && ownFontFamily && !["inherit", "unset"].includes(ownFontFamily.trim().toLowerCase())) {
            fontFamily = ownFontFamily;
        }
        if (element === root) {
            break;
        }
        element = element.parentElement;
    }
    return {excluded: false, fontFamily};
};

export const getInlineFontFamilyState = (protyle: IProtyle, nodeElements?: Element[]) => {
    const fontFamilies: (string | undefined)[] = [];
    let eligible = false;
    const collectBoundary = (boundary: HTMLElement, range?: Range) => {
        if (FONT_FAMILY_EXCLUDED_BLOCK_TYPES.includes(boundary.getAttribute("data-type")) ||
            boundary.classList.contains("li")) {
            return;
        }
        let hasVisibleText = false;
        let roots = [boundary];
        if (!range) {
            roots = Array.from(boundary.querySelectorAll<HTMLElement>('[contenteditable="true"]'));
            if (boundary.matches('[contenteditable="true"]')) {
                roots.unshift(boundary);
            }
            if (roots.length === 0) {
                roots.push(boundary);
            }
        }
        roots.forEach(root => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let textNode = walker.nextNode() as Text;
            while (textNode) {
                if ((!range || range.intersectsNode(textNode)) &&
                    textNode.data.split(Constants.ZWSP).join("")) {
                    hasVisibleText = true;
                    const info = getNodeFontFamily(textNode, protyle.wysiwyg.element);
                    if (!info.excluded) {
                        eligible = true;
                        fontFamilies.push(info.fontFamily);
                    }
                }
                textNode = walker.nextNode() as Text;
            }
        });
        if (!hasVisibleText && !range && boundary.tagName !== "TD" && boundary.tagName !== "TH") {
            const info = getNodeFontFamily(boundary, protyle.wysiwyg.element);
            if (!info.excluded) {
                eligible = true;
                fontFamilies.push(info.fontFamily);
            }
        }
    };

    if (nodeElements?.length) {
        nodeElements.forEach(item => collectBoundary(item as HTMLElement));
        return getInlineFontFamilySelection(fontFamilies, eligible) as IInlineFontFamilyState;
    }

    const range = protyle.toolbar.range;
    if (range.collapsed) {
        const boundary = hasClosestBlock(range.startContainer);
        if (!boundary || FONT_FAMILY_EXCLUDED_BLOCK_TYPES.includes(boundary.getAttribute("data-type"))) {
            return getInlineFontFamilySelection([], false) as IInlineFontFamilyState;
        }
        let positionNode = range.startContainer;
        if (positionNode.nodeType === Node.ELEMENT_NODE) {
            const children = positionNode.childNodes;
            positionNode = children[Math.max(0, range.startOffset - 1)] || children[range.startOffset] || positionNode;
        }
        const info = getNodeFontFamily(positionNode, protyle.wysiwyg.element);
        return getInlineFontFamilySelection(info.excluded ? [] : [info.fontFamily], !info.excluded) as
            IInlineFontFamilyState;
    }

    getBlockRanges(protyle.wysiwyg.element, range, FONT_FAMILY_EXCLUDED_BLOCK_TYPES).forEach(item => {
        collectBoundary(item.blockElement, item.range);
    });
    return getInlineFontFamilySelection(fontFamilies, eligible) as IInlineFontFamilyState;
};

const genFontListItemHTML = (font: IFontItem | undefined, currentFamily: string | null | undefined, id: string) => {
    const family = font?.family || "";
    const name = font?.displayName || window.siyuan.languages.default;
    const search = font ? [font.family, font.displayName, ...(font.aliases || [])].join("\n").toLowerCase() :
        window.siyuan.languages.default.toLowerCase();
    const selected = currentFamily !== null && family === (currentFamily || "");
    return `<div class="b3-list-item b3-list-item--narrow" data-family="${escapeAttr(family)}" id="${id}" role="option" aria-selected="${selected}">
    <span class="b3-menu__label" data-family="${escapeAttr(family)}" data-name="${escapeAttr(name)}" data-search="${escapeAttr(search)}">${escapeHtml(name)}</span>
    ${selected ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>' : ""}
</div>`;
};

let pickerID = 0;

const genFontPickerHTML = (fonts: IFontItem[], options: IFontFamilyPickerOptions, mobile: boolean) => {
    const currentFamily = options.mixed ? null : options.family;
    const items = [undefined, ...fonts];
    const id = `fontFamilyPicker${++pickerID}`;
    const listID = `${id}List`;
    const searchInput = `<input class="b3-text-field fn__flex-1" data-type="font-family-search" role="combobox" aria-expanded="true" aria-controls="${listID}" aria-label="${escapeAttr(window.siyuan.languages.fontFamily)}" placeholder="${escapeAttr(window.siyuan.languages.searchPlaceholder)}">`;
    return `<div class="fn__flex-column${mobile ? "" : " b3-menu__filter"}" style="height:100%">
    <div class="fn__flex">
        ${mobile ? `<button class="block__icon block__icon--show fn__flex-center" data-action="fontFamilyBack" aria-label="${escapeAttr(window.siyuan.languages.back)}"><svg><use xlink:href="#iconLeft"></use></svg></button><span class="fn__space"></span>` : ""}
        ${searchInput}
    </div>
    <div class="fn__hr"></div>
    <div class="b3-list fn__flex-1 b3-list--background" data-type="font-family-list" id="${listID}" role="listbox" style="overflow:auto">${items.map((item, index) => genFontListItemHTML(item, currentFamily, `${id}Option${index}`)).join("")}</div>
</div>`;
};

const bindFontPicker = (element: HTMLElement, options: IFontFamilyPickerOptions) => {
    const listElement = element.querySelector<HTMLElement>('[data-type="font-family-list"]');
    const inputElement = element.querySelector<HTMLInputElement>('[data-type="font-family-search"]');
    let previewObserver: IntersectionObserver;
    let removalObserver: MutationObserver;
    const syncActiveDescendant = () => {
        const activeElement = listElement.querySelector<HTMLElement>(".b3-list-item--focus");
        if (activeElement) {
            inputElement.setAttribute("aria-activedescendant", activeElement.id);
        } else {
            inputElement.removeAttribute("aria-activedescendant");
        }
    };
    const filterFontList = () => {
        const value = inputElement.value.toLowerCase().trim();
        listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
        listElement.querySelectorAll<HTMLElement>(".b3-list-item .b3-menu__label").forEach(item => {
            const visible = !value || item.dataset.search.includes(value);
            item.parentElement.classList.toggle("fn__none", !visible);
            const name = item.dataset.name;
            const index = name.toLowerCase().indexOf(value);
            item.replaceChildren(document.createTextNode(name));
            if (value && index !== -1) {
                const markElement = document.createElement("mark");
                markElement.textContent = name.slice(index, index + value.length);
                item.replaceChildren(
                    document.createTextNode(name.slice(0, index)),
                    markElement,
                    document.createTextNode(name.slice(index + value.length))
                );
            }
        });
        listElement.querySelector<HTMLElement>(".b3-list-item:not(.fn__none)")?.classList.add("b3-list-item--focus");
        syncActiveDescendant();
    };
    const cleanup = () => {
        previewObserver?.disconnect();
        removalObserver?.disconnect();
    };
    const selectItem = (item: HTMLElement) => {
        options.onInteraction?.();
        cleanup();
        options.onSelect(item.dataset.family || undefined);
    };

    if ("IntersectionObserver" in window) {
        previewObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                const labelElement = (entry.target as HTMLElement).querySelector<HTMLElement>(".b3-menu__label");
                if (!entry.isIntersecting || !labelElement?.dataset.family) {
                    labelElement?.style.removeProperty("font-family");
                    return;
                }
                labelElement.style.fontFamily = getInlineFontFamilyStyle(labelElement.dataset.family);
            });
        }, {root: listElement});
        listElement.querySelectorAll<HTMLElement>(".b3-list-item").forEach(item => previewObserver.observe(item));
    } else {
        listElement.querySelectorAll<HTMLElement>('.b3-menu__label[data-family]:not([data-family=""])').forEach(item => {
            item.style.fontFamily = getInlineFontFamilyStyle(item.dataset.family);
        });
    }
    inputElement.addEventListener("keydown", event => {
        options.onInteraction?.();
        event.stopPropagation();
        if (event.isComposing) {
            return;
        }
        upDownHint(listElement, event);
        syncActiveDescendant();
        if (event.key === "Enter") {
            const item = listElement.querySelector<HTMLElement>(".b3-list-item--focus");
            if (item) {
                selectItem(item);
            }
        } else if (event.key === "Escape") {
            event.preventDefault();
            cleanup();
            if (options.onBack) {
                options.onBack();
            } else {
                window.siyuan.menus.menu.remove();
                options.onClose?.();
            }
        }
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        options.onInteraction?.();
        if (!event.isComposing) {
            filterFontList();
        }
    });
    inputElement.addEventListener("compositionend", filterFontList);
    listElement.addEventListener("click", event => {
        const item = (event.target as HTMLElement).closest<HTMLElement>(".b3-list-item");
        if (item) {
            selectItem(item);
        }
    });
    element.querySelector<HTMLElement>('[data-action="fontFamilyBack"]')?.addEventListener("click", event => {
        options.onInteraction?.();
        event.preventDefault();
        event.stopPropagation();
        cleanup();
        options.onBack?.();
    });
    if (options.onBack) {
        removalObserver = new MutationObserver(() => {
            if (!listElement.isConnected) {
                cleanup();
            }
        });
        removalObserver.observe(element, {childList: true});
    }
    filterFontList();
    return cleanup;
};

const loadFontFamilies = async (currentFamily?: string) => {
    let fonts: IFontItem[] = [];
    try {
        fonts = getUniqueFontFamilies(await loadSystemFonts());
    } catch (error) {
        console.warn("load system fonts failed", error);
    }
    if (currentFamily && !fonts.some(font => font.family === currentFamily)) {
        fonts.unshift({family: currentFamily, displayName: currentFamily, weight: 400});
    }
    return fonts;
};

let desktopRequestID = 0;

export const openFontFamilyMenu = async (target: HTMLElement, options: IFontFamilyPickerOptions) => {
    if (options.disabled) {
        return;
    }
    const requestID = ++desktopRequestID;
    const fonts = await loadFontFamilies(options.family);
    if (requestID !== desktopRequestID || !target.isConnected || options.isOpenValid?.() === false) {
        return;
    }
    let cleanup: () => void;
    const menu = new Menu(undefined, () => cleanup?.());
    menu.addItem({
        iconHTML: "",
        type: "empty",
        label: genFontPickerHTML(fonts, options, false),
        bind(element) {
            cleanup = bindFontPicker(element, {
                ...options,
                onClose: () => target.focus(),
                onSelect(family) {
                    menu.close();
                    options.onSelect(family);
                }
            });
        }
    });
    const rect = target.getBoundingClientRect();
    menu.open({x: rect.right, y: rect.top, h: rect.height});
    menu.element.querySelector(".b3-menu__items")?.setAttribute("style", "overflow: initial");
    menu.element.querySelector<HTMLInputElement>('[data-type="font-family-search"]')?.focus();
};

let mobileRequestID = 0;

export const renderMobileFontFamilyMenu = async (element: HTMLElement, options: IFontFamilyPickerOptions) => {
    const requestID = ++mobileRequestID;
    element.innerHTML = `<div class="keyboard__slash-title" data-font-family-request="${requestID}">${window.siyuan.languages.loading}</div>`;
    const fonts = await loadFontFamilies(options.family);
    if (requestID !== mobileRequestID || !element.isConnected ||
        !element.querySelector(`[data-font-family-request="${requestID}"]`) || options.isOpenValid?.() === false) {
        return;
    }
    element.innerHTML = genFontPickerHTML(fonts, options, true);
    bindFontPicker(element, options);
    element.querySelector<HTMLInputElement>('[data-type="font-family-search"]')?.focus();
};

export const getInlineFontFamilyLabel = (state: IInlineFontFamilyState) => state.mixed ?
    window.siyuan.languages.mixed : (state.family || window.siyuan.languages.default);

export const getInlineFontFamilyValue = (family?: string) => getInlineFontFamilyStyle(family);
