import {isMobile} from "../../util/functions";

export const updateBackgroundActions = (protyle: IProtyle) => {
    const element = protyle.background?.element;
    if (!element) {
        return;
    }
    const isDatabaseRow = Boolean(protyle.element.dataset.databaseRowId && protyle.block.showAll &&
        protyle.element.dataset.databaseRowId === protyle.block.id);
    const isDocument = protyle.block.id === protyle.block.rootID;
    element.classList.toggle("protyle-background--hide-actions", isDatabaseRow && !isDocument);
    if (isMobile()) {
        element.classList.toggle("protyle-background--mobileshow", !protyle.block.showAll || (isDatabaseRow && isDocument));
    }
};
