export const getCompressURL = (url: string) => {
    if (url.startsWith("assets/") &&
        (url.endsWith(".png") || url.endsWith(".jpg") || url.endsWith(".jpeg"))) {
        return url + "?style=thumb";
    }
    return url;
};

export const removeCompressURL = (url: string) => {
    if (url.startsWith("assets/") &&
        (url.endsWith(".png?style=thumb") || url.endsWith(".jpg?style=thumb") || url.endsWith(".jpeg?style=thumb"))) {
        return url.replace("?style=thumb", "");
    }
    return url;
};
