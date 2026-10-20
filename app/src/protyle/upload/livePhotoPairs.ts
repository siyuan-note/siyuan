import {Constants} from "../../constants";
import {escapeHtmlTextAndAttr} from "../../util/escape";

export interface ILivePhotoPair {
    photo: File;
    video: File;
}

export const attachLivePhotoVideo = (html: string, video: string) =>
    html.replace(/<img\b/, `<img ${Constants.CUSTOM_SY_LIVE_PHOTO}="1" ${Constants.CUSTOM_SY_LIVE_PHOTO_VIDEO}="${escapeHtmlTextAndAttr(video)}"`);

export const getLivePhotoUploadPairs = (pairs: ILivePhotoPair[], files: File[],
                                        successes: Array<{index: number, path: string, name?: string}>) => {
    const videos = new Map<number, string>();
    const hidden = new Set<number>();
    let incomplete = false;
    const paths = new Map(successes.map(item => [item.index, item.path]));
    pairs.forEach(pair => {
        const photo = files.indexOf(pair.photo);
        const video = files.indexOf(pair.video);
        if (video >= 0) {
            hidden.add(video);
            successes.forEach(item => {
                if (item.index < 0 && item.name === pair.video.name) {
                    hidden.add(item.index);
                }
            });
        }
        if (photo >= 0 && video >= 0 && paths.has(photo) && paths.has(video)) {
            videos.set(photo, paths.get(video));
        } else {
            incomplete = true;
        }
    });
    return {videos, hidden, incomplete};
};
