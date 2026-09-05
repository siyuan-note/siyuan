import {Constants} from "../../constants";
import {addScript} from "../util/addScript";
import {fetchPost} from "../../util/fetch";
import {isBrowserRenderableImagePath} from "../../util/imageURL";
import {copyPNGByLink} from "../../menus/util";

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
                copyElement.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
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
