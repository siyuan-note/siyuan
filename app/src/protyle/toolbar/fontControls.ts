import {Menu} from "../../plugin/Menu";
import {ToolbarItem} from "./ToolbarItem";
import {convertFontSize, fontEvent, getFontNodeElements, getFontSizeInfo} from "./Font";
import {getInlineFontFamilyLabel, getFontFamilyState, getInlineFontFamilyValue, openFontFamilyMenu} from "./fontFamilyMenu";
import {focusByRange, getBlockRanges} from "../util/selection";
import {escapeAttr} from "../../util/escape";
import {isMixedFontSize, normalizeFontSizeInput} from "./fontSizeCore";
import {closeSubElement} from "./subElementLifecycle";
import {getSelectedFontSize} from "./fontSizeSelection";

export const getFontSizeState = (protyle: IProtyle) => {
    const nodes = getFontNodeElements(protyle);
    const info = getFontSizeInfo(protyle, nodes);
    const sizes: string[] = [];
    const range = protyle.toolbar.range;
    if (nodes?.length) {
        nodes.forEach(node => sizes.push(getComputedStyle(node).fontSize));
    } else if (!range.collapsed) {
        const selected = getSelectedFontSize(getBlockRanges(protyle.wysiwyg.element, range));
        if (selected) {
            return {...selected, disabled: false};
        }
    }
    return {...info, mixed: isMixedFontSize(sizes), disabled: nodes?.some(node => node.classList.contains("li")) || false};
};

export const createFontSizePicker = (protyle: IProtyle, onApply: (size: string) => void,
                                     onInteraction?: () => void, onCancel?: () => void) => {
    const state = getFontSizeState(protyle);
    const element = document.createElement("div");
    element.className = "protyle-font-size";
    element.innerHTML = `<label class="fn__flex">${window.siyuan.languages.relativeFontSize}<span class="fn__flex-1"></span>
        <input class="b3-switch" type="checkbox" ${state.fontSize.endsWith("em") ? "checked" : ""}></label>
    <div class="fn__hr"></div>
    <div class="fn__flex"><input class="b3-text-field fn__flex-1" type="number" step="1"
        aria-label="${escapeAttr(window.siyuan.languages.fontSize)}" placeholder="${escapeAttr(window.siyuan.languages.mixed)}">
        <span class="fn__space"></span><span data-unit class="fn__flex-center"></span></div>
    <div class="fn__hr"></div><input class="b3-slider fn__block" type="range" step="1" aria-label="${escapeAttr(window.siyuan.languages.fontSize)}">
    <div class="fn__hr"></div><button class="b3-button fn__block">${window.siyuan.languages.confirm}</button>`;
    const relative = element.querySelector<HTMLInputElement>(".b3-switch");
    const input = element.querySelector<HTMLInputElement>('input[type="number"]');
    const slider = element.querySelector<HTMLInputElement>('input[type="range"]');
    const button = element.querySelector("button");
    const update = (size: string, mixed = false) => {
        input.min = slider.min = relative.checked ? "56" : "9";
        input.max = slider.max = relative.checked ? "450" : "72";
        const value = relative.checked ? Math.round(parseFloat(size) * 100) : Math.round(parseFloat(size));
        input.value = mixed ? "" : value.toString();
        slider.value = value.toString();
        element.querySelector("[data-unit]").textContent = relative.checked ? "%" : "px";
        button.disabled = state.disabled || !normalizeFontSizeInput(input.value, relative.checked);
    };
    const apply = () => {
        const value = normalizeFontSizeInput(input.value, relative.checked);
        if (!state.disabled && value) {
            onApply(value);
        }
    };
    update(state.fontSize, state.mixed);
    relative.addEventListener("change", () => {
        const oldSize = normalizeFontSizeInput(input.value, !relative.checked) || state.fontSize;
        update(convertFontSize(oldSize, relative.checked ? "em" : "px", state.baseFontSize), input.value === "");
    });
    input.addEventListener("input", () => {
        button.disabled = state.disabled || !normalizeFontSizeInput(input.value, relative.checked);
        if (!button.disabled) {
            slider.value = input.value;
        }
    });
    slider.addEventListener("input", () => {
        input.value = slider.value;
        button.disabled = state.disabled;
    });
    button.addEventListener("click", apply);
    element.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            apply();
        } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel?.();
        }
    });
    ["pointerdown", "input", "keydown"].forEach(type => element.addEventListener(type, () => onInteraction?.()));
    return element;
};

export const updateFontControls = (protyle: IProtyle) => {
    const setLabel = (button: HTMLButtonElement, label: string, name: string) => {
        button.querySelector(".protyle-toolbar__font-label").textContent = label;
        button.setAttribute("aria-label", `${window.siyuan.languages[name]} ${label}`);
    };
    const familyButton = protyle.toolbar.element.querySelector<HTMLButtonElement>('[data-type="font-family"]');
    const sizeButton = protyle.toolbar.element.querySelector<HTMLButtonElement>('[data-type="font-size"]');
    if (familyButton) {
        const state = getFontFamilyState(protyle, getFontNodeElements(protyle));
        setLabel(familyButton, getInlineFontFamilyLabel(state), "fontFamily");
        familyButton.disabled = state.disabled;
    }
    if (sizeButton) {
        const state = getFontSizeState(protyle);
        setLabel(sizeButton, state.mixed ? window.siyuan.languages.mixed : state.fontSize.endsWith("em") ?
            `${Math.round(parseFloat(state.fontSize) * 100)}%` : state.fontSize, "fontSize");
        sizeButton.disabled = state.disabled;
    }
};

export class FontControl extends ToolbarItem {
    constructor(protyle: IProtyle, item: IMenuItem) {
        super(protyle, item);
        this.element.classList.add("protyle-toolbar__font");
        this.element.innerHTML = '<span class="protyle-toolbar__font-label"></span><svg aria-hidden="true"><use xlink:href="#iconDown"></use></svg>';
        this.element.querySelector(".protyle-toolbar__font-label").textContent = window.siyuan.languages[item.lang];
        this.element.setAttribute("aria-haspopup", "true");
        this.element.addEventListener("mousedown", event => event.preventDefault());
        this.element.addEventListener("click", () => {
            closeSubElement(protyle.toolbar);
            protyle.toolbar.subElement.classList.add("fn__none");
            const range = protyle.toolbar.range.cloneRange();
            const nodes = getFontNodeElements(protyle);
            const valid = () => range.startContainer.isConnected && range.endContainer.isConnected &&
                !protyle.disabled && this.element.isConnected;
            const apply = (type: string, value: string) => {
                if (!valid()) {
                    return;
                }
                protyle.toolbar.range = range;
                fontEvent(protyle, nodes, type, value);
                protyle.toolbar.render(protyle, protyle.toolbar.range);
            };
            if (item.name === "font-family") {
                void openFontFamilyMenu(this.element, {
                    ...getFontFamilyState(protyle, nodes),
                    isOpenValid: valid,
                    onSelect: family => apply("fontFamily", getInlineFontFamilyValue(family)),
                });
                return;
            }
            const menu = new Menu("inlineFontSize", () => {
                if (valid()) {
                    focusByRange(protyle.toolbar.range);
                }
            });
            if (menu.isOpen) {
                return;
            }
            menu.addItem({type: "empty", label: "", bind: element => {
                element.append(createFontSizePicker(protyle, value => {
                    menu.close();
                    apply("fontSize", value);
                }, undefined, () => menu.close()));
            }});
            const rect = this.element.getBoundingClientRect();
            menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width, target: this.element});
            menu.element.querySelector<HTMLInputElement>('input[type="number"]')?.focus();
        });
    }
}
