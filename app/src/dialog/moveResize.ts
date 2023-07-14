import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {Constants} from "../constants";

export const moveResize = (element: HTMLElement, afterCB?: (type: string) => void) => {
    element.addEventListener("mousedown", (event: MouseEvent & { target: HTMLElement }) => {
        // https://github.com/siyuan-note/siyuan/issues/8746
        if (hasClosestByClassName(event.target, "protyle-util") && !element.classList.contains("protyle-util")) {
            return;
        }
        let iconsElement = hasClosestByClassName(event.target, "resize__move");
        let x: number;
        let y: number;
        const elementRect = element.getBoundingClientRect();
        if (!iconsElement) {
            x = event.clientX;
            y = event.clientY;
            iconsElement = hasClosestByClassName(event.target, "resize__rd") ||
                hasClosestByClassName(event.target, "resize__r") ||
                hasClosestByClassName(event.target, "resize__rt") ||
                hasClosestByClassName(event.target, "resize__d") ||
                hasClosestByClassName(event.target, "resize__l") ||
                hasClosestByClassName(event.target, "resize__ld") ||
                hasClosestByClassName(event.target, "resize__lt") ||
                hasClosestByClassName(event.target, "resize__t");

        } else {
            x = event.clientX - elementRect.left;
            y = event.clientY - elementRect.top;
        }
        if (!iconsElement) {
            return;
        }
        const height = element.clientHeight;
        const width = element.clientWidth;
        const type = iconsElement.className.split("resize__")[1].split(" ")[0];
        const documentSelf = document;
        element.style.userSelect = "none";
        if (element.classList.contains("b3-dialog__container") && element.parentElement.style.display !== "block") {
            element.parentElement.style.display = "block";
            element.style.left = elementRect.left + "px";
            element.style.top = elementRect.top + "px";
            element.style.width = elementRect.width + "px";
        }

        documentSelf.ondragstart = () => false;

        documentSelf.onmousemove = (moveEvent: MouseEvent) => {
            if (!element) {
                return;
            }
            if (type === "move") {
                let positionX = moveEvent.clientX - x;
                let positionY = moveEvent.clientY - y;
                if (positionX > window.innerWidth - width) {
                    positionX = window.innerWidth - width;
                }
                if (positionY > window.innerHeight - height) {
                    positionY = window.innerHeight - height;
                }
                element.style.left = Math.max(positionX, 0) + "px";
                element.style.top = Math.max(positionY, Constants.SIZE_TOOLBAR_HEIGHT) + "px";
            } else {
                if (type === "r" &&
                    moveEvent.clientX - x + width > 200 && moveEvent.clientX - x + width < window.innerWidth) {
                    element.style.width = moveEvent.clientX - x + width + "px";
                } else if (type === "d" &&
                    moveEvent.clientY - y + height > 160 && moveEvent.clientY - y + height < window.innerHeight - Constants.SIZE_TOOLBAR_HEIGHT) {
                    element.style.height = moveEvent.clientY - y + height + "px";
                    element.style.maxHeight = "";
                } else if (type === "t" &&
                    moveEvent.clientY > Constants.SIZE_TOOLBAR_HEIGHT && y - moveEvent.clientY + height > 160) {
                    element.style.top = moveEvent.clientY + "px";
                    element.style.maxHeight = "";
                    element.style.height = (y - moveEvent.clientY + height) + "px";
                } else if (type === "l" &&
                    moveEvent.clientX > 0 && x - moveEvent.clientX + width > 200) {
                    element.style.left = moveEvent.clientX + "px";
                    element.style.width = (x - moveEvent.clientX + width) + "px";
                } else if (type === "rd" &&
                    moveEvent.clientX - x + width > 200 && moveEvent.clientX - x + width < window.innerWidth &&
                    moveEvent.clientY - y + height > 160 && moveEvent.clientY - y + height < window.innerHeight - Constants.SIZE_TOOLBAR_HEIGHT) {
                    element.style.height = moveEvent.clientY - y + height + "px";
                    element.style.maxHeight = "";
                    element.style.width = moveEvent.clientX - x + width + "px";
                } else if (type === "rt" &&
                    moveEvent.clientX - x + width > 200 && moveEvent.clientX - x + width < window.innerWidth &&
                    moveEvent.clientY > Constants.SIZE_TOOLBAR_HEIGHT && y - moveEvent.clientY + height > 160) {
                    element.style.width = moveEvent.clientX - x + width + "px";
                    element.style.top = moveEvent.clientY + "px";
                    element.style.maxHeight = "";
                    element.style.height = (y - moveEvent.clientY + height) + "px";
                } else if (type === "lt" &&
                    moveEvent.clientX > 0 && x - moveEvent.clientX + width > 200 &&
                    moveEvent.clientY > Constants.SIZE_TOOLBAR_HEIGHT && y - moveEvent.clientY + height > 160) {
                    element.style.left = moveEvent.clientX + "px";
                    element.style.width = (x - moveEvent.clientX + width) + "px";
                    element.style.top = moveEvent.clientY + "px";
                    element.style.maxHeight = "";
                    element.style.height = (y - moveEvent.clientY + height) + "px";
                } else if (type === "ld" &&
                    moveEvent.clientX > 0 && x - moveEvent.clientX + width > 200 &&
                    moveEvent.clientY - y + height > 160 && moveEvent.clientY - y + height < window.innerHeight - Constants.SIZE_TOOLBAR_HEIGHT) {
                    element.style.left = moveEvent.clientX + "px";
                    element.style.width = (x - moveEvent.clientX + width) + "px";
                    element.style.height = moveEvent.clientY - y + height + "px";
                    element.style.maxHeight = "";
                }
            }
        };

        documentSelf.onmouseup = () => {
            if (!element) {
                return;
            }
            if (window.siyuan.dragElement) {
                // 反向链接拖拽 https://ld246.com/article/1632915506502
                window.siyuan.dragElement.style.opacity = "";
                window.siyuan.dragElement = undefined;
            }
            element.style.userSelect = "auto";
            documentSelf.onmousemove = null;
            documentSelf.onmouseup = null;
            documentSelf.ondragstart = null;
            documentSelf.onselectstart = null;
            documentSelf.onselect = null;
            if (afterCB) {
                afterCB(type);
            }
        };
    });
};
