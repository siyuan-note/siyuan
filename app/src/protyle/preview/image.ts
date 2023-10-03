import {Constants} from "../../constants";
import {addScript} from "../util/addScript";
import {fetchPost} from "../../util/fetch";

export const previewImage = (src: string) => {
    addScript(`${Constants.PROTYLE_CDN}/js/viewerjs/viewer.js?v=1.10.4`, "protyleViewerScript").then(() => {
            const imagesElement = document.createElement("ul");
            imagesElement.innerHTML = `<li><img src="${src}"></li>`;
            window.siyuan.viewer = new Viewer(imagesElement, {
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
                hidden: function () {
                    window.siyuan.viewer.destroy();
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
                    close: function () {
                        window.siyuan.viewer.destroy();
                    },
                },
            });
            window.siyuan.viewer.show();
    });
};

export const previewDocImage = (src: string, id: string) => {
    addScript(`${Constants.PROTYLE_CDN}/js/viewerjs/viewer.js?v=1.10.4`, "protyleViewerScript").then(() => {
        fetchPost("/api/asset/getDocImageAssets", {id}, (response) => {
            const imagesElement = document.createElement("ul");
            let html = "";
            let initialViewIndex = -1;
            response.data.forEach((item: string, index: number) => {
                if (item) {
                    html += `<li><img src="${item}"></li>`;
                    if (initialViewIndex === -1 && (src.endsWith(encodeURI(item)) || src.endsWith(item))) {
                        initialViewIndex = index;
                    }
                }
            });
            imagesElement.innerHTML = html;
            window.siyuan.viewer = new Viewer(imagesElement, {
                title: [1, (image: HTMLImageElement, imageData: IObject) => {
                    let name = image.alt;
                    if (!name) {
                        name = image.src.substring(image.src.lastIndexOf("/") + 1);
                    }
                    name = name.substring(0, name.lastIndexOf(".")).replace(/-\d{14}-\w{7}$/, "");
                    return `${name} [${imageData.naturalWidth} × ${imageData.naturalHeight}]`;
                }],
                button: false,
                initialViewIndex,
                transition: false,
                hidden: function () {
                    window.siyuan.viewer.destroy();
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
                    close: function () {
                        window.siyuan.viewer.destroy();
                    },
                },
            });
            window.siyuan.viewer.show();
        });
    });
};
