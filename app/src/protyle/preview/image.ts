import {Constants} from "../../constants";
import {addScript} from "../util/addScript";
import {fetchPost} from "../../util/fetch";

export const previewImage = (src: string, id: string) => {
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
            // @ts-ignore
            const viewer = new Viewer(imagesElement, {
                button: false,
                initialViewIndex,
                transition: false,
                hidden: function () {
                    viewer.destroy();
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
                        viewer.destroy();
                    },
                },
            });
            viewer.show();
        });
    });
};
