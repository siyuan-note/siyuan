import {Constants} from "../../constants";
import {addScript} from "../util/addScript";
import {fetchPost} from "../../util/fetch";

export const previewImages = (srcList: string[], currentSrc?: string) => {
    addScript(`${Constants.PROTYLE_CDN}/js/viewerjs/viewer.js?v=1.11.7`, "protyleViewerScript").then(() => {
        const imagesElement = document.createElement("ul");
        let html = "";
        let initialViewIndex = -1;
        srcList.forEach((item: string, index: number) => {
            if (item) {
                html += `<li><img src="${item}"></li>`;
                if (currentSrc && initialViewIndex === -1 && (currentSrc.endsWith(encodeURI(item)) || currentSrc.endsWith(item))) {
                    initialViewIndex = index;
                }
            }
        });
        imagesElement.innerHTML = html;
        window.siyuan.viewer = new Viewer(imagesElement, {
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

export const previewDocImage = (currentSrc: string, id: string) => {
    fetchPost("/api/asset/getDocImageAssets", {id}, (response) => {
        previewImages(response.data, currentSrc);
    });
};

export const previewAttrViewImages = (currentSrc: string, avID: string, viewID: string, query: string) => {
    fetchPost("/api/av/getCurrentAttrViewImages", {
        id: avID,
        viewID,
        query,
    }, (response) => {
        previewImages(response.data, currentSrc);
    });
};
