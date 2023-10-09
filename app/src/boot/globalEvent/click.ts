import {getAllModels} from "../../layout/getAll";
import {hasClosestByAttribute, hasClosestByClassName, hasTopClosestByClassName} from "../../protyle/util/hasClosest";
import {hideAllElements} from "../../protyle/ui/hideElements";
import {isWindow} from "../../util/functions";
import {writeText} from "../../protyle/util/compatibility";
import {showMessage} from "../../dialog/message";

export const globalClick = (event: MouseEvent & { target: HTMLElement }) => {
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
    // dock float 时，点击空白处，隐藏 dock
    const floatDockLayoutElement = hasClosestByClassName(event.target, "layout--float", true);
    if (floatDockLayoutElement && window.siyuan.layout.leftDock) {
        if (!floatDockLayoutElement.isSameNode(window.siyuan.layout.bottomDock.layout.element)) {
            window.siyuan.layout.bottomDock.hideDock();
        }
        if (!floatDockLayoutElement.isSameNode(window.siyuan.layout.leftDock.layout.element)) {
            window.siyuan.layout.leftDock.hideDock();
        }
        if (!floatDockLayoutElement.isSameNode(window.siyuan.layout.rightDock.layout.element)) {
            window.siyuan.layout.rightDock.hideDock();
        }
    } else if (!hasClosestByClassName(event.target, "dock") && !isWindow() && window.siyuan.layout.leftDock) {
        window.siyuan.layout.bottomDock.hideDock();
        window.siyuan.layout.leftDock.hideDock();
        window.siyuan.layout.rightDock.hideDock();
    }

    const copyElement = hasTopClosestByClassName(event.target, "protyle-action__copy");
    if (copyElement) {
        let text = copyElement.parentElement.nextElementSibling.textContent.trimEnd()
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
