import {setStorageVal} from "../../protyle/util/compatibility";
import {escapeHtml} from "../../util/escape";
import {isMobileBarsAutoHide, MOBILE_BARS_CONFIG_KEY} from "./mobileBarsConfig";
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
        const config = {autoHide: (event.target as HTMLInputElement).checked};
        window.siyuan.storage[MOBILE_BARS_CONFIG_KEY] = config;
        setStorageVal(MOBILE_BARS_CONFIG_KEY, config);
        showMobileBars();
    });
};
