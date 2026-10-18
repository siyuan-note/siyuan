import {patchAppearancePreference} from "../../config/tabs/appearancePreferences";
import {escapeHtml} from "../../util/escape";
import {isMobileBarsAutoHide} from "./mobileBarsConfig";
import {showMobileBars} from "./mobileBars";

export const genMobileBarsSettingHTML = () => `<label class="b3-label fn__flex config-item">
    <div class="fn__flex-1 config-item__main">
        <div class="config-name">${escapeHtml(window.siyuan.languages.mobileBarsAutoHide)}</div>
        <div class="b3-label__text">${escapeHtml(window.siyuan.languages.mobileBarsAutoHideTip)}</div>
    </div>
    <input id="mobileBarsAutoHide" type="checkbox" class="b3-switch fn__flex-center"${isMobileBarsAutoHide() ? " checked" : ""}${window.siyuan.config.readonly || window.siyuan.isPublish ? " disabled" : ""}>
</label>`;

export const mountMobileBarsSetting = (root: HTMLElement) => {
    root.querySelector<HTMLInputElement>("#mobileBarsAutoHide")?.addEventListener("change", (event) => {
        void patchAppearancePreference("mobileBars.autoHide", (event.target as HTMLInputElement).checked).then(() => {
            syncMobileBarsSetting(root);
            showMobileBars();
        });
    });
};

export const syncMobileBarsSetting = (root: ParentNode = document) => {
    root.querySelectorAll<HTMLInputElement>("#mobileBarsAutoHide").forEach(input => {
        input.checked = isMobileBarsAutoHide();
        input.disabled = window.siyuan.config.readonly || window.siyuan.isPublish;
    });
};
