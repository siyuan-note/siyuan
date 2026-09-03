let englishLanguages: Record<string, string> | undefined;
let englishLanguagesPromise: Promise<Record<string, string> | undefined> | undefined;

export const getEnglishCommandLabel = (key: string) => englishLanguages?.[key];

export const requestEnglishCommandTranslations = async (
    version: string,
    fetcher: typeof fetch = fetch,
) => {
    const response = await fetcher(`/appearance/langs/en.json?v=${version}`, {cache: "no-store"});
    if (!response.ok) {
        throw new Error(`Unable to load English commands: ${response.status}`);
    }
    return response.json() as Promise<Record<string, string>>;
};

export const initializeEnglishCommandTranslations = (
    currentLanguage: string,
    currentLanguages: Record<string, string>,
    version: string,
) => {
    if (currentLanguage === "en") {
        englishLanguages = currentLanguages;
        return Promise.resolve(englishLanguages);
    }
    if (!englishLanguagesPromise) {
        englishLanguagesPromise = requestEnglishCommandTranslations(version)
            .then(languages => {
                englishLanguages = languages;
                return languages;
            })
            .catch(error => {
                console.warn("Unable to load English command translations:", error);
                return undefined;
            });
    }
    return englishLanguagesPromise;
};
