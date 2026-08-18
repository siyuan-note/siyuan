import {renderAssetsPreview} from "../asset/renderAssets";
import {Constants} from "../constants";
import {confirmDialog} from "../dialog/confirmDialog";
import type {App} from "../index";
import {Protyle} from "../protyle";
import {saveExportFile} from "../protyle/util/compatibility";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {escapeAttr, escapeHtml} from "../util/escape";
import {fetchPost} from "../util/fetch";
import {pathPosix} from "../util/pathName";
import * as dayjs from "dayjs";

interface IRepoFile {
    fileID: string;
    indexID: string;
    title: string;
    hPath?: string;
    hSize: string;
    updated: number;
}

let repoFileRequestId = 0;

export const renderRepoFileList = (files: IRepoFile[], element: Element, showPath: boolean, showCompare = false) => {
    if (files.length === 0) {
        element.innerHTML = `<li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
        return;
    }

    let html = "";
    files.forEach((item) => {
        if (showCompare) {
            html += `<li class="b3-list-item b3-list-item--hide-action" data-type="searchFileItem" data-id="${item.fileID}" data-snapshot="${item.indexID}" data-created="${item.updated}" data-title="${escapeAttr(item.title)}">
    <span class="b3-list-item__text">${dayjs(item.updated).format("YYYY-MM-DD HH:mm:ss")}</span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="saveAs" aria-label="${window.siyuan.languages.saveAs}">
        <svg><use xlink:href="#iconDownload"></use></svg>
    </span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="selectVersion" aria-pressed="false" aria-label="${window.siyuan.languages.compare}">
        <svg><use xlink:href="#iconUncheck"></use></svg>
    </span>
</li>`;
            return;
        }
        const pathHTML = showPath && item.hPath ? `${escapeHtml(item.hPath)}<span class="fn__space"></span>` : "";
        /// #if MOBILE
        html += `<li class="b3-list-item" data-type="searchFileItem" data-id="${item.fileID}" data-snapshot="${item.indexID}" data-created="${item.updated}">
    <div class="fn__flex-1">
        <div style="padding-top:8px" class="b3-list-item__text">${escapeHtml(item.title)}</div>
        <div class="b3-list-item__meta">
            ${item.hSize}
            <span class="fn__space"></span>
            ${dayjs(item.updated).format("YYYY-MM-DD HH:mm:ss")}
        </div>
        <div class="fn__flex" style="height: 26px">
            <span class="fn__flex-1"></span>
            <span class="b3-list-item__action" data-type="saveAs">
                <svg><use xlink:href="#iconDownload"></use></svg>
                <span class="fn__space"></span>${window.siyuan.languages.saveAs}
            </span>
            <span class="fn__space"></span>
            <span class="b3-list-item__action" data-type="rollback">
                <svg><use xlink:href="#iconUndo"></use></svg>
                <span class="fn__space"></span> ${window.siyuan.languages.rollback}
            </span>
        </div>
    </div>
</li>`;
        /// #else
        html += `<li class="b3-list-item b3-list-item--hide-action" data-type="searchFileItem" data-id="${item.fileID}" data-snapshot="${item.indexID}" data-created="${item.updated}">
    <div class="fn__flex-1">
        <span class="b3-list-item__text">${escapeHtml(item.title)}</span>
        <div class="b3-list-item__meta">
            ${pathHTML}${item.hSize}
            <span class="fn__space"></span>
            ${dayjs(item.updated).format("YYYY-MM-DD HH:mm:ss")}
        </div>
    </div>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="saveAs" aria-label="${window.siyuan.languages.saveAs}">
        <svg><use xlink:href="#iconDownload"></use></svg>
    </span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-type="rollback" aria-label="${window.siyuan.languages.rollback}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
</li>`;
        /// #endif
    });
    element.innerHTML = html;
};

export const rollbackRepoFile = (element: Element) => {
    if (window.siyuan.config.readonly) {
        return;
    }

    const name = element.getAttribute("data-title") || element.querySelector(".b3-list-item__text").textContent.trim();
    const time = dayjs(parseInt(element.getAttribute("data-created"))).format("YYYY-MM-DD HH:mm:ss");
    confirmDialog("⚠️ " + window.siyuan.languages.rollback,
        window.siyuan.languages.rollbackConfirm.replace("${name}", name).replace("${time}", time),
        () => {
            fetchPost("/api/repo/rollbackRepoSnapshotFile", {
                id: element.getAttribute("data-id")
            });
        });
};

export const saveRepoFile = (element: Element) => {
    fetchPost("/api/repo/exportRepoFile", {
        id: element.getAttribute("data-id")
    }, (response) => {
        saveExportFile(response.data.path);
    });
};

export const renderRepoFile = (app: App, element: Element, contentElement: Element,
                               onEditor?: (editor: Protyle) => void) => {
    const fileId = element.getAttribute("data-id");
    const snapshotId = element.getAttribute("data-snapshot") || "";
    const requestId = (++repoFileRequestId).toString();
    contentElement.setAttribute("data-id", fileId);
    contentElement.setAttribute("data-request-id", requestId);
    contentElement.innerHTML = '<div style="border-radius: var(--b3-border-radius-b);"></div>';
    fetchPost("/api/repo/openRepoSnapshotFile", {
        id: fileId
    }, (response) => {
        if (!contentElement.isConnected || contentElement.getAttribute("data-request-id") !== requestId) {
            return;
        }
        const type = pathPosix().extname(response.data.content).toLowerCase();
        if (Constants.SIYUAN_ASSETS_IMAGE.concat(Constants.SIYUAN_ASSETS_AUDIO).concat(Constants.SIYUAN_ASSETS_VIDEO).includes(type)) {
            contentElement.firstElementChild.innerHTML = renderAssetsPreview(response.data.content);
        } else if (response.data.displayInText) {
            contentElement.innerHTML = '<textarea readonly class="b3-text-field fn__block" style="height: 100%"></textarea>';
            (contentElement.firstElementChild as HTMLTextAreaElement).value = response.data.content || response.data.title;
        } else {
            const viewEditor = new Protyle(app, contentElement.firstElementChild as HTMLElement, {
                blockId: "",
                action: [Constants.CB_GET_HISTORY],
                history: {
                    snapshot: snapshotId
                },
                render: {
                    background: false,
                    gutter: false,
                    breadcrumb: false,
                    breadcrumbDocName: false,
                },
                typewriterMode: false
            });
            disabledProtyle(viewEditor.protyle);
            onEditor?.(viewEditor);
            onGet({
                data: response,
                protyle: viewEditor.protyle,
                action: [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML],
            });
        }
    });
};
