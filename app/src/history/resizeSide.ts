import {Constants} from "../constants";
import {setStorageVal} from "../protyle/util/compatibility";
import {hasClosestByClassName} from "../protyle/util/hasClosest";

export const resizeSide = (targetElement: HTMLElement, previousElement: HTMLElement, key?: string) => {
    targetElement.addEventListener("mousedown", (event: MouseEvent & { target: HTMLElement }) => {
        const parentElement = hasClosestByClassName(previousElement, "b3-dialog__body") || hasClosestByClassName(previousElement, "protyle-util");
        if (!parentElement) {
            return;
        }
        parentElement.style.userSelect = "none";
        parentElement.style.pointerEvents = "none";

        const documentSelf = document;
        documentSelf.ondragstart = () => false;

        const x = event.clientX;
        const width = previousElement.clientWidth;
        const maxWidth = parentElement.clientWidth - 256;
        documentSelf.onmousemove = (moveEvent: MouseEvent) => {
            const newWidth = width + (moveEvent.clientX - x);
            if (newWidth < 256 || newWidth > maxWidth) {
                return;
            }
            previousElement.style.width = newWidth + "px";
        };

        documentSelf.onmouseup = () => {
            parentElement.style.userSelect = "auto";
            parentElement.style.pointerEvents = "";
            documentSelf.onmousemove = null;
            documentSelf.onmouseup = null;
            documentSelf.ondragstart = null;
            documentSelf.onselectstart = null;
            documentSelf.onselect = null;
            if (key) {
                window.siyuan.storage[Constants.LOCAL_HISTORY][key] = previousElement.clientWidth + "px";
                setStorageVal(Constants.LOCAL_HISTORY, window.siyuan.storage[Constants.LOCAL_HISTORY]);
            }
        };
    });
};
