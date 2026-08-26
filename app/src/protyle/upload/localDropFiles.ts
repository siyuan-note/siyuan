export const hasDataTransferFiles = (types: ArrayLike<string>) => Array.from(types).includes("Files");

export const getLocalDropFiles = (files: FileList | File[], getPath: (file: File) => string) => {
    const localFiles: ILocalFiles[] = [];
    for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const path = getPath(file);
        if (!path) {
            return undefined;
        }
        localFiles.push({
            path,
            size: file.size,
            isDir: file.size === 0 && file.type === "" && !file.name.includes("."),
        });
    }
    return localFiles;
};
