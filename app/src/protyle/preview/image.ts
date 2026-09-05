import {Constants} from "../../constants";
import {addScript} from "../util/addScript";
import {fetchPost} from "../../util/fetch";
import {isBrowserRenderableImagePath} from "../../util/imageURL";
import {copyPNGByLink, writeAssetToClipboard} from "../../menus/util";
import {isEncryptedBox} from "../../util/pathName";

const getCopyFileMenu = (src: string) => {
    try {
        const url = new URL(src, window.location.href);
        const path = decodeURIComponent(url.pathname);
        const box = url.searchParams.get("box");
        if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol) ||
            !path.startsWith("/assets/") || path.includes("\\") || path.split("/").includes("..") ||
            isEncryptedBox(box)) {
            return;
        }
        const menu = writeAssetToClipboard(path.substring(1) + (box ? `?box=${encodeURIComponent(box)}` : ""));
        return menu.ignore ? undefined : menu;
    } catch {
        return;
    }
};

export const previewImages = (srcList: string[], currentSrc?: string, onHidden?: () => void) => {
    addScript(`${Constants.PROTYLE_CDN}/js/viewerjs/viewer.js?v=1.11.8`, "protyleViewerScript").then(() => {
        const imagesElement = document.createElement("ul");
        let html = "";
        let initialViewIndex = -1;
        srcList.forEach((item: string, index: number) => {
            if (item) {
                html += `<li><img src="${encodeURI(item)}"></li>`;
                if (currentSrc && initialViewIndex === -1 && (currentSrc.endsWith(encodeURI(item)) || currentSrc.endsWith(item))) {
                    initialViewIndex = index;
                }
            }
        });
        imagesElement.innerHTML = html;
        let cleanedUp = false;
        const close = () => {
            viewer.destroy();
            if (!cleanedUp) {
                cleanedUp = true;
                onHidden?.();
            }
        };
        const viewer = new Viewer(imagesElement, {
            initialViewIndex: currentSrc ? initialViewIndex : 0,
            title: [1, (image: HTMLImageElement, imageData: IObject) => {
                let name = image.alt;
                if (!name) {
                    name = image.src.substring(image.src.lastIndexOf("/") + 1);
                }
                name = name.substring(0, name.lastIndexOf(".")).replace(/-\d{14}-\w{7}$/, "");
                return `${name} [${imageData.naturalWidth} × ${imageData.naturalHeight}]`;
            }],
            button: false,
            transition: false,
            ready: () => {
                const copyElement = viewer.toolbar.querySelector(".viewer-copy");
                copyElement.innerHTML = '<svg><use xlink:href="#iconImage"></use></svg>';
                const copyFileElement = viewer.toolbar.querySelector(".viewer-copy-file");
                copyFileElement.innerHTML = '<svg><use xlink:href="#iconFile"></use></svg>';
                copyFileElement.classList.add("fn__none");
                const languages = window.siyuan.languages;
                const labels: Record<string, string> = {
                    "zoom-in": languages.zoomIn,
                    "zoom-out": languages.zoomOut,
                    "one-to-one": languages.pageScaleActual,
                    reset: languages.reset,
                    prev: languages.previous,
                    play: languages.imageViewerPlay,
                    next: languages.next,
                    "rotate-left": languages.rotateCcw,
                    "rotate-right": languages.rotateCw,
                    "flip-horizontal": languages.imageFlipHorizontal,
                    "flip-vertical": languages.imageFlipVertical,
                    copy: languages.copyAsPNG,
                    "copy-file": languages.copyFile,
                    close: languages.close,
                };
                Object.entries(labels).forEach(([action, label]) => {
                    const button = viewer.toolbar.querySelector(`.viewer-${action}`);
                    button.classList.add("ariaLabel");
                    button.setAttribute("aria-label", label);
                    button.setAttribute("data-position", "north");
                });
            },
            hidden: close,
            view: () => {
                viewer.toolbar.querySelector(".viewer-copy-file").classList.add("fn__none");
            },
            viewed: () => {
                viewer.toolbar.querySelector(".viewer-copy-file").classList.toggle("fn__none", !getCopyFileMenu(viewer.image.src));
            },
            toolbar: {
                zoomIn: true,
                zoomOut: true,
                oneToOne: true,
                reset: true,
                prev: true,
                play: true,
                next: true,
                rotateLeft: true,
                rotateRight: true,
                flipHorizontal: true,
                flipVertical: true,
                copy: () => {
                    if (viewer.viewed && viewer.image) {
                        copyPNGByLink(viewer.image.src);
                    }
                },
                copyFile: () => {
                    if (viewer.viewed && viewer.image) {
                        getCopyFileMenu(viewer.image.src)?.click();
                    }
                },
                close,
            },
        });
        window.siyuan.viewer = viewer;
        viewer.show();
    });
};

export const previewDocImage = (currentSrc: string, id: string) => {
    fetchPost("/api/asset/getDocImageAssets", {id}, (response) => {
        previewImages(response.data, currentSrc);
    });
};

export const previewAttrViewImages = (currentSrc: string, avID: string, blockID: string, viewID: string, query: string) => {
    fetchPost("/api/av/getCurrentAttrViewImages", {
        id: avID,
        blockID,
        viewID,
        query,
    }, (response) => {
        previewImages(response.data.filter((item: string) => isBrowserRenderableImagePath(item)), currentSrc);
    });
};
