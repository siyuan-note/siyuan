import {getSettingItem} from "./item";

const settingSaveBoundWraps = new WeakSet<HTMLElement>();

export const bindSettingSaveDelegation = (tabWrap: HTMLElement) => {
    if (settingSaveBoundWraps.has(tabWrap)) {
        return;
    }
    settingSaveBoundWraps.add(tabWrap);
    tabWrap.addEventListener("input", onSettingTabWrapInput);
    tabWrap.addEventListener("change", onSettingTabWrapChange);
};

const onSettingTabWrapInput = (event: Event) => {
    const el = event.target;
    if (el instanceof HTMLInputElement && el.matches(".b3-slider") && el.type === "range") {
        el.parentElement.setAttribute("aria-label", el.value);
    }
};

const onSettingTabWrapChange = (event: Event) => {
    if (window.siyuan.config.readonly) {
        console.warn("[config] setting save skipped because config is readonly");
        return;
    }
    const el = event.target as HTMLElement;
    if (!el.matches(".b3-switch, .b3-select, .b3-textarea, .b3-text-field, .b3-slider")) {
        return;
    }
    const controlId = el.id || el.getAttribute("data-control-id");
    if (!controlId) {
        return;
    }
    const item = getSettingItem(controlId);
    if (!item?.save || !item.readValue) {
        return;
    }
    const value = item.readValue(el);
    if (value !== undefined) {
        void item.save(value);
    }
};
