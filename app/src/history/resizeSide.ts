import {Constants} from "../constants";
import {setStorageVal} from "../protyle/util/compatibility";
import {hasClosestByClassName} from "../protyle/util/hasClosest";

export const resizeSide = (targetElement: HTMLElement, element: HTMLElement, key:string) => {
    targetElement.addEventListener("mousedown", (event: MouseEvent & { target: HTMLElement }) => {
        const dialogBodyElement = hasClosestByClassName(element, "b3-dialog__body");
        if (!dialogBodyElement) {
            return;
        }
        dialogBodyElement.style.userSelect = "none";

        const documentSelf = document;
        documentSelf.ondragstart = () => false;

        const x = event.clientX;
        const width = element.clientWidth;
        const maxWidth = dialogBodyElement.clientWidth - 256;
        documentSelf.onmousemove = (moveEvent: MouseEvent) => {
            const newWidth = width + (moveEvent.clientX - x);
            if (newWidth < 256 || newWidth > maxWidth) {
                return;
            }
            element.style.width = newWidth + "px";
        };

        documentSelf.onmouseup = () => {
            dialogBodyElement.style.userSelect = "auto";
            documentSelf.onmousemove = null;
            documentSelf.onmouseup = null;
            documentSelf.ondragstart = null;
            documentSelf.onselectstart = null;
            documentSelf.onselect = null;
            window.siyuan.storage[Constants.LOCAL_HISTORY][key] = element.clientWidth + "px";
            setStorageVal(Constants.LOCAL_HISTORY, window.siyuan.storage[Constants.LOCAL_HISTORY]);
        };
    });
};
