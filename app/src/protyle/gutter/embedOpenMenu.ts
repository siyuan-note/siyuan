import {Constants} from "../../constants";
import {escapeHtml} from "../../util/escape";
/// #if MOBILE
import {openMobileFileById} from "../../mobile/editor";
/// #endif
/// #if !MOBILE
import {BlockPanel} from "../../block/Panel";
/// #endif

export const openEmbedBlock = (protyle: IProtyle, target: HTMLElement, id: string) => {
    if (!id) {
        return;
    }
    /// #if MOBILE
    openMobileFileById(protyle.app, id, [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL], "start");
    /// #else
    window.siyuan.blockPanels.push(new BlockPanel({
        app: protyle.app,
        isBacklink: false,
        targetElement: target,
        refDefs: [{refID: id}],
    }));
    /// #endif
};

export const embedOpenMenu = (protyle: IProtyle, embed: Element): IMenu => {
    const results = Array.from(embed.querySelectorAll<HTMLElement>(":scope > .protyle-wysiwyg__embed[data-id]"))
        .filter(result => result.dataset.id);
    const openResult = (result: HTMLElement): IMenu => ({
        id: result.dataset.id,
        icon: "iconPictureInPicture",
        label: escapeHtml(result.querySelector(`[data-node-id="${result.dataset.id}"]`)?.textContent.trim().slice(0, 80) ||
            result.dataset.id),
        click: () => openEmbedBlock(protyle, result, result.dataset.id),
    });
    return {
        id: "refPopover",
        icon: "iconPictureInPicture",
        label: window.siyuan.languages.refPopover,
        disabled: results.length === 0,
        ...(results.length > 1 ? {submenu: results.map(openResult)} : {
            click: () => {
                if (results[0]) {
                    openEmbedBlock(protyle, results[0], results[0].dataset.id);
                }
            },
        }),
    };
};
