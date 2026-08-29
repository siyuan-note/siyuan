export const getAssetUploadSuccesses = (data?: {
    succFiles?: IAssetUploadSuccess[],
    succMap?: Record<string, string>
}): IAssetUploadSuccess[] => {
    if (Array.isArray(data?.succFiles)) {
        return data.succFiles;
    }
    return Object.entries(data?.succMap || {}).map(([name, path], index) => ({index, name, path}));
};

export const getAssetUploadPathsByInput = (inputCount: number,
                                            result: Omit<IAssetUploadResult, "requestId" | "input">) => {
    const paths: Array<string | undefined> = new Array(inputCount).fill(undefined);
    const rejected = new Set((result.rejected || []).map(item => item.index));
    const succeeded = new Map<number, string>();
    if (Array.isArray(result.succFiles)) {
        result.succFiles.forEach(item => succeeded.set(item.index, item.path));
    } else if (result.succMap && result.acceptedInput) {
        const names = result.acceptedInput.kind === "files" ?
            result.acceptedInput.files.map(file => file.name) :
            result.acceptedInput.files.map(file => file.path.split(/[\\/]/).pop() || "");
        const nameCounts = new Map<string, number>();
        names.forEach(name => nameCounts.set(name, (nameCounts.get(name) || 0) + 1));
        names.forEach((name, index) => {
            if (nameCounts.get(name) === 1 && Object.prototype.hasOwnProperty.call(result.succMap, name)) {
                succeeded.set(index, result.succMap[name]);
            }
        });
    }
    let acceptedIndex = 0;
    for (let inputIndex = 0; inputIndex < inputCount; inputIndex++) {
        if (rejected.has(inputIndex)) {
            continue;
        }
        paths[inputIndex] = succeeded.get(acceptedIndex);
        acceptedIndex++;
    }
    return paths;
};

export const getCompleteAssetUploadPathsByInput = (inputCount: number,
                                                     result: Omit<IAssetUploadResult, "requestId" | "input">) => {
    if (result.status !== "success") {
        return;
    }
    const paths = getAssetUploadPathsByInput(inputCount, result);
    if (paths.some(path => !path)) {
        return;
    }
    return paths as string[];
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
        const failedFiles = response.data?.failedFiles as IAssetUploadFailure[] | undefined;
        const errFiles = response.data?.errFiles as string[] | undefined;
        if (Array.isArray(succFiles) || succMap) {
            const expected = acceptedInput.files.length;
            const succeeded = Array.isArray(succFiles) ? succFiles.length : Object.keys(succMap).length;
            const hasFailures = Boolean(failedFiles?.length || errFiles?.length || rejected.length ||
                (typeof response.code === "number" && response.code !== 0));
            const status = succeeded === expected && !hasFailures ? "success" :
                succeeded > 0 ? "partial" : "failed";
            return {
                ...inputResult,
                status,
                succFiles,
                failedFiles,
                succMap,
                errFiles,
                error: response.code === 0 ? undefined : String(response.msg || ""),
            };
        }
        if (typeof response.code === "number" && response.code !== 0) {
            return {
                ...inputResult,
                status: "failed",
                succFiles,
                failedFiles,
                succMap,
                errFiles,
                error: String(response.msg || ""),
            };
        }
    } catch (error) {
        // 自定义上传接口不一定返回 JSON，HTTP 200 仍视为成功。
    }
    return {...inputResult, status: rejected.length > 0 ? "partial" : "success"};
};
