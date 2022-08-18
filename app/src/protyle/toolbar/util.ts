import {fetchPost} from "../../util/fetch";

export const previewTemplate = (pathString: string, element: Element) => {
    fetchPost("/api/file/getFile", {path: pathString.replace(window.siyuan.config.system.dataDir, "")}, (response) => {
        element.innerHTML = response.data;
    })
}
