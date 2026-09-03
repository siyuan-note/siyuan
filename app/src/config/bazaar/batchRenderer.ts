export const BAZAAR_CARD_BATCH_SIZE = 24;

export const filterBazaarPackagesByThemeMode = <T extends {modes?: string[]}>(
    packages: T[],
    bazaarType: TBazaarType,
    themeModeValue?: string,
) => {
    if (bazaarType !== "themes" || !["0", "1"].includes(themeModeValue || "")) {
        return packages;
    }
    const themeMode = themeModeValue === "0" ? "light" : "dark";
    return packages.filter((item) => !item.modes?.length || item.modes.includes(themeMode));
};

export const getNextBazaarCardBatch = <T>(packages: T[], cursor: number, batchSize = BAZAAR_CARD_BATCH_SIZE) => {
    const nextCursor = Math.min(cursor + batchSize, packages.length);
    return {
        packages: packages.slice(cursor, nextCursor),
        nextCursor,
        complete: nextCursor >= packages.length,
    };
};
