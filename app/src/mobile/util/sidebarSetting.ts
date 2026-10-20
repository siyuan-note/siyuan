import {patchAppearancePreference} from "../../config/tabs/appearancePreferences";
import {escapeHtml} from "../../util/escape";
import {getMobileSidebarConfig} from "./mobileBarsConfig";
import {updateSidebarButtons} from "./sidebarButtons";
import {showMobileBars} from "./mobileBars";

const settings = ["sidebarSwipe", "sidebarButtons"] as const;

export const genSidebarSettingHTML = () => settings.map(key => `<label class="b3-label fn__flex config-item">
    <div class="fn__flex-1 config-item__main">
        <div class="config-name">${escapeHtml(key === "sidebarSwipe" ? window.siyuan.languages.mobileSidebarSwipe : window.siyuan.languages.mobileSidebarButtons)}</div>
        <div class="b3-label__text">${escapeHtml(window.siyuan.languages.mobileSidebarAccessTip)}</div>
    </div>
    <input data-sidebar-setting="${key}" type="checkbox" class="b3-switch fn__flex-center">
</label>`).join("");

export const syncSidebarSetting = (root: ParentNode = document) => {
    const config = getMobileSidebarConfig();
    settings.forEach(key => {
        const input = root.querySelector<HTMLInputElement>(`[data-sidebar-setting="${key}"]`);
        if (!input) {
            return;
        }
        input.checked = config[key];
        input.disabled = window.siyuan.config.readonly || window.siyuan.isPublish ||
            !config[key === "sidebarSwipe" ? "sidebarButtons" : "sidebarSwipe"];
    });
};

export const mountSidebarSetting = (root: HTMLElement) => {
    const render = () => syncSidebarSetting(root);
    settings.forEach(key => {
        root.querySelector<HTMLInputElement>(`[data-sidebar-setting="${key}"]`)?.addEventListener("change", event => {
            if (window.siyuan.config.readonly || window.siyuan.isPublish) {
                render();
                return;
            }
            const current = getMobileSidebarConfig();
            const checked = (event.target as HTMLInputElement).checked;
            if (!checked && !current[key === "sidebarSwipe" ? "sidebarButtons" : "sidebarSwipe"]) {
                render();
                return;
            }
            void patchAppearancePreference(`mobileBars.${key}`, checked).then(() => {
                render();
                updateSidebarButtons();
                showMobileBars();
            });
        });
    });
    render();
};
