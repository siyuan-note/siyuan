import {hideElements} from "../ui/hideElements";
import {getAllModels} from "../../layout/getAll";
import {updateOutline} from "../../editor/util";
import {resize} from "./resize";

export const setEditMode = (protyle: IProtyle, type: TEditorMode) => {
    if (type === "preview") {
        if (!protyle.preview.element.classList.contains("fn__none")) {
            return;
        }
        protyle.preview.element.classList.remove("fn__none");
        protyle.contentElement.classList.add("fn__none");
        protyle.scroll?.element.classList.add("fn__none");
        if (protyle.options.render.breadcrumb) {
            protyle.breadcrumb?.element.classList.add("fn__none");
            protyle.breadcrumb.toggleExit(true);
        }
        protyle.preview.render(protyle);
        /// #if !MOBILE
        updateOutline(getAllModels(), protyle, true);
        /// #endif
    } else if (type === "wysiwyg") {
        if (!protyle.contentElement.classList.contains("fn__none")) {
            return;
        }
        protyle.preview.element.classList.add("fn__none");
        protyle.contentElement.classList.remove("fn__none");
        if (protyle.options.render.scroll) {
            protyle.scroll?.element.classList.remove("fn__none");
        }
        if (protyle.options.render.breadcrumb) {
            protyle.breadcrumb?.element.classList.remove("fn__none");
            protyle.breadcrumb.toggleExit(!protyle.block.showAll);
        }
        /// #if !MOBILE
        updateOutline(getAllModels(), protyle, true);
        /// #endif
        resize(protyle);
    }
    hideElements(["gutterOnly", "toolbar", "select", "hint", "util"], protyle);
    protyle.app.plugins.forEach(item => {
        item.eventBus.emit("switch-protyle-mode", {protyle});
    });
};
