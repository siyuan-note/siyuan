/**
 * 将相对路径段合并进已有段数组：`..` 向上一级（已在根时不再上移），`.` 与空段忽略。
 * 会就地修改 `pathSegments` 并返回同一数组。
 */
export const mergePathSegments = (pathSegments: string[], segments: string[]): string[] => {
    for (const segment of segments) {
        if (segment === "..") {
            if (pathSegments.length > 0) {
                pathSegments.pop();
            }
        } else if (segment && segment !== ".") {
            pathSegments.push(segment);
        }
    }
    return pathSegments;
};
