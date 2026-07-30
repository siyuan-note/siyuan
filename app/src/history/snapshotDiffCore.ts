export const pairSnapshotFilesByPath = <T extends {path: string}>(left: T[], right: T[]) => {
    const rightByPath = new Map(right.map((file) => {
        return [file.path.replaceAll("\\", "/"), file];
    }));
    return left.map((file) => ({
        file,
        compareFile: rightByPath.get(file.path.replaceAll("\\", "/")),
    }));
};
