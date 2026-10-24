import {Constants} from "../../constants";
import {Dialog} from "../../dialog";
import {setStorageVal} from "../util/compatibility";
import {normalizeHeadingPageBreakLevels} from "./headingPageBreaks";

export const headingPageBreakControls = (levels: unknown) => {
    const selected = normalizeHeadingPageBreakLevels(levels);
    return [1, 2, 3, 4, 5, 6].map(level => `<label class="fn__flex">
    <span class="fn__flex-1">H${level}</span>
    <input type="checkbox" class="b3-switch fn__flex-center" value="${level}" ${selected.includes(level) ? "checked" : ""}>
</label>`).join('<div class="fn__hr--small"></div>');
};

export const openHeadingPageBreakDialog = (onConfirm: () => void) => {
    const localData = window.siyuan.storage[Constants.LOCAL_EXPORTPDF];
    const dialog = new Dialog({
        title: window.siyuan.languages.print,
        content: `<div class="b3-dialog__content">
    <label class="fn__flex b3-label b3-label--inner">
        <div class="fn__flex-1">${window.siyuan.languages.exportTitleImage}</div>
        <span class="fn__space"></span>
        <input id="titleImage" type="checkbox" class="b3-switch fn__flex-center" ${localData.titleImage !== false ? "checked" : ""}>
    </label>
    <div>${window.siyuan.languages.pdfHeadingPageBreaks}</div>
    <div class="ft__smaller ft__on-surface">${window.siyuan.languages.pdfHeadingPageBreaksTip}</div>
    <div class="fn__hr"></div>
    <div data-heading-page-breaks>${headingPageBreakControls(localData.headingPageBreakLevels)}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: "360px",
    });
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector(".b3-button--text").addEventListener("click", () => {
        localData.titleImage = dialog.element.querySelector<HTMLInputElement>("#titleImage").checked;
        localData.headingPageBreakLevels = Array.from(dialog.element.querySelectorAll<HTMLInputElement>(
            "[data-heading-page-breaks] input:checked")).map(input => Number(input.value));
        setStorageVal(Constants.LOCAL_EXPORTPDF, localData);
        dialog.destroy();
        onConfirm();
    });
};
