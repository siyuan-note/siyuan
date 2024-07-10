import {getAllModels} from "../../layout/getAll";
import {
    hasClosestByAttribute,
    hasClosestByClassName,
    hasTopClosestByClassName
} from "../../protyle/util/hasClosest";
import {hideAllElements} from "../../protyle/ui/hideElements";
import {isWindow} from "../../util/functions";
import {writeText} from "../../protyle/util/compatibility";
import {showMessage} from "../../dialog/message";

export const globalClick = (event: MouseEvent & { target: HTMLElement }) => {
    const ghostElement = document.getElementById("dragGhost");
    if (ghostElement) {
        if (ghostElement.dataset.ghostType === "dock") {
            ghostElement.parentElement.querySelectorAll(".dock__item").forEach((item: HTMLElement) => {
                item.style.opacity = "";
            });
            document.querySelector("#dockMoveItem")?.remove();
        } else {
            const startElement = ghostElement.parentElement.querySelector(`[data-node-id="${ghostElement.getAttribute("data-node-id")}"]`) as HTMLElement;
            startElement ? startElement.style.opacity = "" : "";
            ghostElement.parentElement.querySelectorAll(".dragover__top, .dragover__bottom, .dragover").forEach((item: HTMLElement) => {
                item.classList.remove("dragover__top", "dragover__bottom", "dragover");
                item.style.opacity = "";
            });
        }
        ghostElement.remove();
    }
    if (!window.siyuan.menus.menu.element.contains(event.target) && !hasClosestByAttribute(event.target, "data-menu", "true")) {
        if (getSelection().rangeCount > 0 && window.siyuan.menus.menu.element.contains(getSelection().getRangeAt(0).startContainer) &&
            window.siyuan.menus.menu.element.contains(document.activeElement)) {
            // https://ld246.com/article/1654567749834/comment/1654589171218#comments
        } else {
            window.siyuan.menus.menu.remove();
        }
    }
    // protyle.toolbar 点击空白处时进行隐藏
    if (!hasClosestByClassName(event.target, "protyle-toolbar")) {
        hideAllElements(["toolbar"]);
    }
    if (!hasClosestByClassName(event.target, "pdf__outer")) {
        hideAllElements(["pdfutil"]);
    }
    // dock float 时，点击空白处，隐藏 dock。场景：文档树上重命名后
    if (!isWindow() && window.siyuan.layout.leftDock &&
        !hasClosestByClassName(event.target, "b3-dialog--open", true) &&
        !hasClosestByClassName(event.target, "b3-menu") &&
        !hasClosestByClassName(event.target, "block__popover") &&
        !hasClosestByClassName(event.target, "dock") &&
        !hasClosestByClassName(event.target, "layout--float", true)
    ) {
        window.siyuan.layout.bottomDock.hideDock();
        window.siyuan.layout.leftDock.hideDock();
        window.siyuan.layout.rightDock.hideDock();
    }

    const protyleElement = hasClosestByClassName(event.target, "protyle", true);
    if (protyleElement) {
        const wysiwygElement = protyleElement.querySelector(".protyle-wysiwyg");
        if (wysiwygElement.getAttribute("data-readonly") === "true" || !wysiwygElement.contains(event.target)) {
            wysiwygElement.dispatchEvent(new Event("focusin"));
        }
    }
    const copyElement = hasTopClosestByClassName(event.target, "protyle-action__copy");
    if (copyElement) {
        let text = copyElement.parentElement.nextElementSibling.textContent.trimEnd();
        text = text.replace(/\u00A0/g, " "); // Replace non-breaking spaces with normal spaces when copying https://github.com/siyuan-note/siyuan/issues/9382
        writeText(text);
        showMessage(window.siyuan.languages.copied, 2000);
        event.preventDefault();
        return;
    }

    // 点击空白，pdf 搜索、更多消失
    if (hasClosestByAttribute(event.target, "id", "secondaryToolbarToggle") ||
        hasClosestByAttribute(event.target, "id", "viewFind") ||
        hasClosestByAttribute(event.target, "id", "findbar")) {
        return;
    }
    let currentPDFViewerObject: any;
    getAllModels().asset.find(item => {
        if (item.pdfObject &&
            !item.pdfObject.appConfig.appContainer.classList.contains("fn__none")) {
            currentPDFViewerObject = item.pdfObject;
            return true;
        }
    });
    if (!currentPDFViewerObject) {
        return;
    }
    if (currentPDFViewerObject.secondaryToolbar.isOpen) {
        currentPDFViewerObject.secondaryToolbar.close();
    }
    if (
        !currentPDFViewerObject.supportsIntegratedFind &&
        currentPDFViewerObject.findBar.opened
    ) {
        currentPDFViewerObject.findBar.close();
    }
};
