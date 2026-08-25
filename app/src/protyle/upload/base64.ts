import {type IUploadInsertOptions, uploadFiles} from "./index";
import {getAssetUploadPathsByInput} from "./uploadResult";
import {createBase64ImageFile} from "./base64File";

export const base64ToURL = async (base64SrcList: string[], protyle: IProtyle,
                                  options?: IUploadInsertOptions) => {
    const files: File[] = [];
    const fileSourceIndices: number[] = [];
    base64SrcList.forEach((item, sourceIndex) => {
        const file = createBase64ImageFile(item, `base64image-${Lute.NewNodeID()}`);
        if (!file) {
            return;
        }
        files.push(file);
        fileSourceIndices.push(sourceIndex);
    });
    const paths: Array<string | undefined> = new Array(base64SrcList.length).fill(undefined);
    if (files.length === 0) {
        return paths;
    }
    return new Promise<Array<string | undefined>>((resolve) => {
        let settled = false;
        uploadFiles(protyle, files, undefined, (_responseText, result) => {
            getAssetUploadPathsByInput(files.length, result).forEach((path, fileIndex) => {
                paths[fileSourceIndices[fileIndex]] = path;
            });
            settled = true;
            resolve(paths);
        }, () => {
            if (!settled) {
                settled = true;
                resolve(paths);
            }
        }, {...options, requiredFileCount: files.length});
    });
};
