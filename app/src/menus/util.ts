/// #if !BROWSER
import {dialog} from "@electron/remote";
import {SaveDialogReturnValue} from "electron";
/// #endif
import {fetchPost} from "../util/fetch";
import {getAssetName, pathPosix} from "../util/pathName";

export const exportAsset = (src: string) => {
    /// #if !BROWSER
    return {
        label: window.siyuan.languages.export,
        icon: "iconUpload",
        click() {
            dialog.showSaveDialog({
                defaultPath: getAssetName(src) + pathPosix().extname(src),
                properties: ["showOverwriteConfirmation"],
            }).then((result: SaveDialogReturnValue) => {
                if (!result.canceled) {
                    fetchPost("/api/file/copyFile", {src, dest: result.filePath});
                }
            });
        }
    };
    /// #endif
};
