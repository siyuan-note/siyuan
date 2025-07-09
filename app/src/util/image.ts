export const getCompressURL = (url: string) => {
    if (url.startsWith("assets/") &&
        (url.endsWith(".png") || url.endsWith(".jpg") || url.endsWith(".jpeg"))) {
        return url + "?style=thumb";
    }
};
