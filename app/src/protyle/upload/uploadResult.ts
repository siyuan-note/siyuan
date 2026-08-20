export const getAssetUploadSuccesses = (data?: {
    succFiles?: IAssetUploadSuccess[],
    succMap?: Record<string, string>
}): IAssetUploadSuccess[] => {
    if (Array.isArray(data?.succFiles)) {
        return data.succFiles;
    }
    return Object.entries(data?.succMap || {}).map(([name, path], index) => ({index, name, path}));
};

export const getAssetUploadResult = (responseText: string, acceptedInput: IAssetUploadInput,
                                     rejected: IAssetUploadRejection[] = []):
Omit<IAssetUploadResult, "requestId" | "input"> => {
    const inputResult = {
        acceptedInput,
        rejected: rejected.length > 0 ? rejected : undefined,
    };
    try {
        const response = JSON.parse(responseText);
        const succMap = response.data?.succMap as Record<string, string> | undefined;
        const succFiles = response.data?.succFiles as IAssetUploadSuccess[] | undefined;
        const errFiles = response.data?.errFiles as string[] | undefined;
        if (typeof response.code === "number" && response.code !== 0) {
            return {...inputResult, status: "failed", succFiles, succMap, errFiles, error: String(response.msg || "")};
        }
        if (Array.isArray(succFiles) || succMap) {
            const expected = acceptedInput.files.length;
            const succeeded = Array.isArray(succFiles) ? succFiles.length : Object.keys(succMap).length;
            const status = succeeded === expected && !errFiles?.length && rejected.length === 0 ? "success" :
                succeeded > 0 ? "partial" : "failed";
            return {...inputResult, status, succFiles, succMap, errFiles};
        }
    } catch (error) {
        // 自定义上传接口不一定返回 JSON，HTTP 200 仍视为成功。
    }
    return {...inputResult, status: rejected.length > 0 ? "partial" : "success"};
};
