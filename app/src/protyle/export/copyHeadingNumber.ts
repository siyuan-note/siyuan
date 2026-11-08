import {Constants} from "../../constants";
import {MobileDialog} from "../../dialog/mobileDialog";
import {fetchSyncPost} from "../../util/fetch";
import {resolveHeadingNumberEnabled} from "../util/headingNumberCore";

export const selectCopyHeadingNumber = async (id: string, title: string): Promise<boolean | undefined> => {
    const response = await fetchSyncPost("/api/block/getDocInfo", {id});
    if (response.code !== 0) {
        return;
    }
    if (!resolveHeadingNumberEnabled(response.data.ial[Constants.CUSTOM_SY_HEADING_NUMBER],
        window.siyuan.config.editor.headingNumber)) {
        return true;
    }
    return new Promise(resolve => {
        const dialog = new MobileDialog({
            title,
            content: `<div class="b3-dialog__content">
<label class="fn__flex b3-label config-item">
    <div class="fn__flex-1">
        <div class="config-name">${window.siyuan.languages.headingNumber}</div>
        <div class="b3-label__text">${window.siyuan.languages.headingNumberTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" type="checkbox" checked>
</label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.copy}</button>
</div>`,
            width: "520px",
            destroyCallback: () => resolve(undefined),
        });
        const buttons = dialog.element.querySelectorAll(".b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            resolve(dialog.element.querySelector<HTMLInputElement>("input").checked);
            dialog.destroy();
        });
    });
};
