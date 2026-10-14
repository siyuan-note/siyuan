import {isEncryptedBox} from "../util/pathName";

export const getImageOCRAvailability = (path: string, notebookId: string) => {
    const reference = (path || "").split("#", 1)[0];
    const [pathname, query = ""] = reference.split("?", 2);
    const boxId = new URLSearchParams(query).get("box")?.trim();
    const text = !isEncryptedBox(notebookId) && !isEncryptedBox(boxId);
    const local = text && pathname.startsWith("assets/");
    const ai = local && /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif)$/i.test(pathname);
    return {text, local, ai};
};
