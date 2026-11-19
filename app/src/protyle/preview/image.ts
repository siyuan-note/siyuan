import {Constants} from "../../constants";
import {addScript} from "../util/addScript";
import {fetchPost} from "../../util/fetch";
import {isBrowserRenderableImagePath} from "../../util/imageURL";
import {copyPNGByLink, writeAssetToClipboard} from "../../menus/util";
import {isEncryptedBox} from "../../util/pathName";
import {createLivePhotoPlayer} from "./livePhoto";
import {writeClipboardData} from "../util/compatibility";
import {showMessage} from "../../dialog/message";
import {getZIndex} from "../../util/zIndex";
import {escapeHtmlTextAndAttr} from "../../util/escape";

type ImageSource = {src: string, video?: string, notebook?: string};

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

const showImageGallery = (sources: Array<ImageSource & {url: string}>, initialViewIndex: number, onHidden?: () => void) => {
    addScript(`${Constants.PROTYLE_CDN}/js/viewerjs/viewer.js?v=1.14.0`, "protyleViewerScript").then(() => {
        const imagesElement = document.createElement("ul");
        imagesElement.innerHTML = sources.map(({url}) => `<li><img src="${escapeHtmlTextAndAttr(url)}"></li>`).join("");
        let cleanedUp = false;
        let stopLivePhoto: () => void;
        let liveButton: HTMLElement;
        let currentIndex = initialViewIndex >= 0 ? initialViewIndex : 0;
        const stopLive = () => {
            stopLivePhoto?.();
            stopLivePhoto = undefined;
        };
        imagesElement.addEventListener("play", stopLive);
        imagesElement.addEventListener("playing", stopLive);
        const close = () => {
            stopLive();
            viewer.destroy();
            if (!cleanedUp) {
                cleanedUp = true;
                onHidden?.();
            }
        };
        const viewer = new Viewer(imagesElement, {
            initialViewIndex,
            title: [1, (image: HTMLImageElement, imageData: IObject) => {
                let name = image.alt;
                if (!name) {
                    name = image.src.substring(image.src.lastIndexOf("/") + 1);
                }
                name = name.substring(0, name.lastIndexOf(".")).replace(/-\d{14}-\w{7}$/, "");
                return `${currentIndex + 1}/${imagesElement.childElementCount} ${name} [${imageData.naturalWidth} × ${imageData.naturalHeight}]`;
            }],
            button: false,
            magnifier: false,
            navigation: true,
            transition: false,
            ready: () => {
                window.siyuan.zIndex = Math.max(window.siyuan.zIndex + 1, getZIndex(viewer.viewer));
                viewer.viewer.style.zIndex = window.siyuan.zIndex.toString();
                const copyURLElement = document.createElement("li");
                copyURLElement.className = "viewer-copy-url ariaLabel";
                copyURLElement.tabIndex = 0;
                copyURLElement.setAttribute("role", "button");
                copyURLElement.setAttribute("aria-label", window.siyuan.languages.copyImageURL);
                copyURLElement.setAttribute("data-position", "north");
                copyURLElement.innerHTML = '<svg><use xlink:href="#iconLink"></use></svg>';
                const copyURL = async () => {
                    if (!viewer.viewed || !viewer.image) {
                        return;
                    }
                    const result = await writeClipboardData({textPlain: sources[currentIndex].src})
                        .catch(() => ({status: "failed"}));
                    if (result.status === "failed") {
                        showMessage(window.siyuan.languages.copyImageURLFailed, 7000, "error");
                        return;
                    }
                    showMessage(window.siyuan.languages.copied);
                };
                copyURLElement.addEventListener("click", event => {
                    event.stopPropagation();
                    copyURL();
                });
                copyURLElement.addEventListener("keydown", event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        copyURL();
                    }
                });
                viewer.toolbar.querySelector("ul").append(copyURLElement);
                if (sources.some(source => source.video)) {
                    liveButton = document.createElement("li");
                    liveButton.className = "viewer-live-photo ariaLabel fn__none";
                    liveButton.tabIndex = 0;
                    liveButton.setAttribute("role", "button");
                    liveButton.setAttribute("aria-label", window.siyuan.languages.livePhoto);
                    liveButton.setAttribute("data-position", "north");
                    liveButton.innerHTML = '<svg><use xlink:href="#iconImagePlay"></use></svg>';
                    const play = () => {
                        if (stopLivePhoto) {
                            stopLive();
                            return;
                        }
                        const source = sources[currentIndex];
                        if (source?.video) {
                            stopLivePhoto = createLivePhotoPlayer(viewer.viewer, source.video, viewer.image.src, source.notebook);
                        }
                    };
                    liveButton.addEventListener("click", event => {
                        event.stopPropagation();
                        play();
                    });
                    liveButton.addEventListener("keydown", event => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            play();
                        }
                    });
                    viewer.toolbar.querySelector("ul").append(liveButton);
                }
                viewer.toolbar.querySelector(".viewer-play").classList.remove("viewer-large");
                const copyElement = viewer.toolbar.querySelector(".viewer-copy");
                copyElement.innerHTML = '<svg><use xlink:href="#iconImage"></use></svg>';
                const copyFileElement = viewer.toolbar.querySelector(".viewer-copy-file");
                copyFileElement.innerHTML = '<svg><use xlink:href="#iconFile"></use></svg>';
                copyFileElement.classList.add("fn__none");
                const languages = window.siyuan.languages;
                ["prev", "next"].forEach((action) => {
                    const button = viewer.viewer.querySelector(`.viewer-navigation > .viewer-${action}`);
                    button.innerHTML = action === "prev" ? '<svg><use xlink:href="#iconLeft"></use></svg>' :
                        '<svg><use xlink:href="#iconRight"></use></svg>';
                    button.classList.add("ariaLabel");
                    button.setAttribute("aria-label", action === "prev" ? languages.previous : languages.next);
                    button.setAttribute("data-position", action === "prev" ? "east" : "west");
                });
                const labels: Record<string, string> = {
                    "zoom-in": languages.zoomIn,
                    "zoom-out": languages.zoomOut,
                    "one-to-one": languages.pageScaleActual,
                    reset: languages.reset,
                    play: languages.imageViewerPlay,
                    "rotate-left": languages.rotateCcw,
                    "rotate-right": languages.rotateCw,
                    "flip-horizontal": languages.imageFlipHorizontal,
                    "flip-vertical": languages.imageFlipVertical,
                    copy: languages.copyAsPNG,
                    "copy-file": languages.copyFile,
                };
                Object.entries(labels).forEach(([action, label]) => {
                    const button = viewer.toolbar.querySelector(`.viewer-${action}`);
                    button.classList.add("ariaLabel");
                    button.setAttribute("aria-label", label);
                    button.setAttribute("data-position", "north");
                });
            },
            hidden: close,
            view: event => {
                stopLive();
                currentIndex = event?.detail?.index ?? currentIndex;
                liveButton?.classList.toggle("fn__none", !sources[currentIndex]?.video);
                viewer.toolbar.querySelector(".viewer-copy-file").classList.add("fn__none");
            },
            viewed: () => {
                viewer.toolbar.querySelector(".viewer-copy-file").classList.toggle("fn__none", !getCopyFileMenu(viewer.image.src));
            },
            toolbar: {
                zoomIn: true,
                zoomOut: true,
                oneToOne: true,
                prev: false,
                play: true,
                next: false,
                rotateLeft: true,
                rotateRight: true,
                flipHorizontal: true,
                flipVertical: true,
                reset: true,
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
            },
        });
        const destroyViewer = viewer.destroy.bind(viewer);
        viewer.destroy = () => {
            stopLive();
            imagesElement.removeEventListener("play", stopLive);
            imagesElement.removeEventListener("playing", stopLive);
            destroyViewer();
        };
        window.siyuan.viewer = viewer;
        viewer.show();
    });
};

export const previewImages = (srcList: Array<string | ImageSource>, currentSrc?: string, onHidden?: () => void, currentVideo?: string) => {
    const sources = srcList.flatMap(source => {
        const item = typeof source === "string" ? {src: source} : source;
        return item.src ? [{...item, url: encodeURI(item.src)}] : [];
    });
    const initialViewIndex = currentSrc ? sources.findIndex(({src, url, video}) =>
        (currentSrc.endsWith(url) || currentSrc.endsWith(src)) &&
        (currentVideo === undefined || (video || "") === currentVideo)) : 0;
    showImageGallery(sources, initialViewIndex, onHidden);
};

export const previewDocImage = (currentSrc: string, id: string, currentVideo?: string, image?: HTMLElement) => {
    const field = image?.closest(".av__richtext-host, .av__celltext--rich");
    if (field) {
        const images = Array.from(field.querySelectorAll("img[src]:not(.emoji)"), element =>
            ({element, src: element.getAttribute("src")})).filter(({src}) => src);
        const index = images.findIndex(({element}) => element === image);
        if (index >= 0) {
            showImageGallery(images.map(({src}) => ({src, url: src})), index);
        }
        return;
    }
    const embed = image?.closest(".protyle-wysiwyg__embed");
    const sourceID = embed?.getAttribute("data-root-id") || embed?.getAttribute("data-id") || id;
    fetchPost("/api/asset/getDocPreviewImages", {id: sourceID}, (response) => {
        previewImages(response.data, currentSrc, undefined, currentVideo);
    });
};

export const previewAttrViewImages = (currentSrc: string, avID: string, blockID: string, viewID: string, query: string, groupID?: string) => {
    fetchPost("/api/av/getCurrentAttrViewImages", {
        id: avID,
        blockID,
        viewID,
        query,
        groupID,
    }, (response) => {
        const images = (response.data || []).filter((item: string) => isBrowserRenderableImagePath(item));
        if (images.length > 0) {
            previewImages(images, currentSrc);
        }
    });
};
