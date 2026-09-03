import {reloadProtyle} from "./reload";
import {setEditMode} from "./setEditMode";

export const toggleEditMode = (protyle: IProtyle) => {
    if (protyle.preview.element.classList.contains("fn__none")) {
        setEditMode(protyle, "preview");
        return;
    }
    setEditMode(protyle, "wysiwyg");
    reloadProtyle(protyle, true);
};
