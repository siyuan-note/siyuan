import {fetchPost} from "../../util/fetch";

export const previewTemplate = (pathString: string, element: Element) => {
    fetchPost("/api/file/getFile", {path: pathString.replace(window.siyuan.config.system.dataDir.substring(0, window.siyuan.config.system.dataDir.length - 4), "")}, (response) => {
        element.innerHTML = `<div class="b3-typography">${response.data}</div>`;
    })
}
