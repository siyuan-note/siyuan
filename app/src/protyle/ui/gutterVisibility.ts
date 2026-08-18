export const hideGutterElements = (elements: HTMLElement[], hidden: boolean) => {
    elements.forEach(item => {
        if (hidden) {
            item.classList.add("fn__none");
        }
        item.innerHTML = "";
    });
};

export const shouldHideGutterAfterFold = (foldStatus: number) => foldStatus < 0;

const GUTTER_FOLD_RESTORE_ATTRIBUTE = "data-fold-restore-id";

export const markGutterForFoldRestore = (element: HTMLElement, id: string | null, foldStatus: number) => {
    if (!id || shouldHideGutterAfterFold(foldStatus)) {
        element.removeAttribute(GUTTER_FOLD_RESTORE_ATTRIBUTE);
        return false;
    }
    element.setAttribute(GUTTER_FOLD_RESTORE_ATTRIBUTE, id);
    return true;
};

export const consumeGutterFoldRestore = (element: HTMLElement, id: string) => {
    if (element.getAttribute(GUTTER_FOLD_RESTORE_ATTRIBUTE) !== id) {
        return false;
    }
    element.removeAttribute(GUTTER_FOLD_RESTORE_ATTRIBUTE);
    return true;
};
