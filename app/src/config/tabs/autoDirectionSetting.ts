import type {SettingTabBuilder} from "../setting/builder";
import {fetchPost} from "../../util/fetch";
import {editorConfigApi} from "./editorRuntime";

const saveAutoTextDirection = (value: boolean) => {
    const payload: Config.IEditor = {
        ...window.siyuan.config.editor,
        autoTextDirection: value,
        rtl: value ? false : window.siyuan.config.editor.rtl,
    };
    fetchPost("/api/setting/setEditor", payload, (response) => {
        editorConfigApi.apply(response.data as Config.IEditor);
    });
};

const bindDirectionModeExclusivity = (root: HTMLElement) => {
    const autoElement = root.querySelector<HTMLInputElement>(`#${CSS.escape("editor.autoTextDirection")}`);
    const rtlElement = document.getElementById("editor.rtl") as HTMLInputElement | null;
    if (!autoElement || !rtlElement) {
        return;
    }

    // Capture before the existing RTL save handler so its payload already contains autoTextDirection=false.
    rtlElement.addEventListener("change", () => {
        if (!rtlElement.checked) {
            return;
        }
        window.siyuan.config.editor.autoTextDirection = false;
        autoElement.checked = false;
    }, true);

    autoElement.addEventListener("change", () => {
        if (autoElement.checked) {
            rtlElement.checked = false;
        }
    });
};

export const registerAutoDirectionAppearanceSetting = (tab: SettingTabBuilder) => {
    const group = tab.group("content", window.siyuan.languages.configGroupContent);
    group.switch("editor.autoTextDirection", {
        title: `A↔א · ${window.siyuan.languages.ltr} / ${window.siyuan.languages.rtl}`,
        save: saveAutoTextDirection,
        afterMount: bindDirectionModeExclusivity,
    });
};
