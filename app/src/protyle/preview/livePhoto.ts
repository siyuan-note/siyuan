import {fetchSyncPost} from "../../util/fetch";
import {fetchWithAppId} from "../../util/fetchWithAppId";
import {ContractFormData} from "../../util/contractFormData";
import type {LivePhotoPreviewSession, LivePhotoFrameRequestInput, LivePhotoPreviewRequestInput} from "../../types/api";

const activePlayers = new Set<{boxes: string[], close: () => void}>();
const incompatibleOriginals = new Set<string>();

export const closeNotebookLivePhotos = (box: string) => {
    activePlayers.forEach(player => {
        if (player.boxes.includes(box)) {
            player.close();
        }
    });
    incompatibleOriginals.forEach(path => {
        if (new URL(path, location.origin + "/").searchParams.get("box") === box) {
            incompatibleOriginals.delete(path);
        }
    });
};

export const livePhotoAssetPath = (path: string) => {
    try {
        const url = new URL(path, location.origin + "/");
        if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol) ||
            !url.pathname.startsWith("/assets/") || decodeURIComponent(url.pathname).includes("\\") ||
            decodeURIComponent(url.pathname).split("/").some(part => part === "..")) {
            return "";
        }
        return url.pathname.slice(1) + url.search;
    } catch {
        return "";
    }
};

const binaryPreview = async (url: "/api/asset/getLivePhotoFrame" | "/api/asset/getLivePhotoPreview",
                             data: LivePhotoFrameRequestInput | LivePhotoPreviewRequestInput, signal: AbortSignal) => {
    const response = await fetchWithAppId(url, {
        method: "POST", body: JSON.stringify(data), cache: "no-store", signal,
    });
    if (!response.ok || response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Live Photo preview unavailable");
    }
    return response;
};

// 浏览器已支持的扩展色域值尚未全部包含在 TypeScript 的 DOM 声明中。
const colorSpace = (session: LivePhotoPreviewSession) => ({
    primaries: ({1: "bt709", 5: "bt470bg", 6: "smpte170m", 9: "bt2020", 12: "smpte432"} as const)[session.color.primaries],
    transfer: ({1: "bt709", 6: "smpte170m", 13: "iec61966-2-1", 14: "bt2020-10", 15: "bt2020-12"} as const)[session.color.transfer],
    matrix: ({1: "bt709", 5: "bt470bg", 6: "smpte170m", 9: "bt2020-ncl"} as const)[session.color.matrix],
    fullRange: session.color.fullRange,
}) as unknown as VideoColorSpaceInit;

const encodePreview = async (session: LivePhotoPreviewSession, signal: AbortSignal) => {
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
        throw new Error("VideoEncoder unavailable");
    }
    const fps = session.frames.length * 1e6 / (session.frames.at(-1).timestamp + session.frames.at(-1).duration);
    const config: VideoEncoderConfig = {
        codec: session.width * session.height <= 1920 * 1440 ? "avc1.4D0032" : "avc1.4D0034",
        width: session.width, height: session.height, framerate: fps,
        bitrate: Math.min(24e6, Math.max(6e6, session.width * session.height * fps * 0.15)),
        latencyMode: "realtime", hardwareAcceleration: "no-preference", avc: {format: "annexb"},
    };
    if (!(await VideoEncoder.isConfigSupported(config)).supported) {
        throw new Error("AVC encoding unavailable");
    }
    const packets: Uint8Array[] = [];
    let encoderError: Error;
    let lastTimestamp = -1;
    let bytes = 0;
    const encoder = new VideoEncoder({
        error: error => { encoderError = error; },
        output: chunk => {
            if (chunk.timestamp <= lastTimestamp || bytes + chunk.byteLength > 64 * 1024 * 1024) {
                encoderError = new Error("Invalid AVC output");
                return;
            }
            lastTimestamp = chunk.timestamp;
            const packet = new Uint8Array(chunk.byteLength);
            chunk.copyTo(packet);
            packets.push(packet);
            bytes += packet.byteLength;
        },
    });
    try {
        encoder.configure(config);
        for (let index = 0; index < session.frames.length; index++) {
            signal.throwIfAborted();
            if (encoderError) {
                throw encoderError;
            }
            const response = await binaryPreview("/api/asset/getLivePhotoFrame", {id: session.id, index}, signal);
            const data = new Uint8Array(await response.arrayBuffer());
            signal.throwIfAborted();
            const frame = new VideoFrame(data, {
                format: "I420", codedWidth: session.width, codedHeight: session.height,
                ...session.frames[index], colorSpace: colorSpace(session),
            });
            try {
                encoder.encode(frame, {keyFrame: index === 0});
            } finally {
                frame.close();
                data.fill(0);
            }
            if (encoder.encodeQueueSize >= 2) {
                await encoder.flush();
            }
        }
        await encoder.flush();
        if (encoderError || packets.length !== session.frames.length) {
            throw encoderError || new Error("Incomplete AVC output");
        }
        const encoded = new Uint8Array(4 + 4 * packets.length + bytes);
        const view = new DataView(encoded.buffer);
        view.setUint32(0, packets.length);
        let offset = 4;
        packets.forEach(packet => {
            view.setUint32(offset, packet.byteLength);
            encoded.set(packet, offset + 4);
            offset += 4 + packet.byteLength;
        });
        const form = new ContractFormData({id: session.id, file: new Blob([encoded])});
        const result = await fetchSyncPost("/api/asset/finishLivePhotoPreview", form, undefined, false, signal);
        encoded.fill(0);
        if (result.code !== 0) {
            throw new Error("Live Photo preview encoding failed");
        }
    } finally {
        if (encoder.state !== "closed") {
            encoder.close();
        }
        packets.forEach(packet => packet.fill(0));
    }
};

const cancelPreview = (id: string) => {
    if (id) {
        void fetchSyncPost("/api/asset/cancelLivePhotoPreview", {id}, undefined, false).catch(() => {});
    }
};

// 每次显式播放先试原片；检测实际解码帧，兼容只有声音和时间推进的 HEVC 播放失败。
const playOriginal = (video: HTMLVideoElement, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    let callback: number;
    const finish = (error?: Error) => {
        clearTimeout(timer);
        if (callback !== undefined) {
            video.cancelVideoFrameCallback(callback);
        }
        video.removeEventListener("error", failed);
        signal.removeEventListener("abort", aborted);
        if (error) {
            reject(error);
        } else {
            resolve();
        }
    };
    const failed = () => finish(new Error("Original Live Photo playback unavailable"));
    const aborted = () => finish(new DOMException("Aborted", "AbortError"));
    video.addEventListener("error", failed, {once: true});
    signal.addEventListener("abort", aborted, {once: true});
    if (video.requestVideoFrameCallback) {
        callback = video.requestVideoFrameCallback(() => finish());
    }
    const timer = window.setTimeout(() => {
        if ((video.getVideoPlaybackQuality?.().totalVideoFrames || 0) > 0) {
            finish();
        } else {
            failed();
        }
    }, 3000);
    void video.play().catch(finish);
});

export const createLivePhotoPlayer = (host: HTMLElement, path: string, poster: string, notebook?: string) => {
    const assetPath = livePhotoAssetPath(path);
    const abort = new AbortController();
    const video = document.createElement("video");
    const status = document.createElement("span");
    const container = document.createElement("div");
    container.className = "live-photo-preview";
    video.controls = true;
    video.playsInline = true;
    video.poster = poster;
    status.className = "ft__on-surface";
    status.textContent = window.siyuan.languages.loading;
    container.append(video, status);
    container.addEventListener("click", event => event.stopPropagation());
    host.append(container);
    let sessionID = "";
    let objectURL = "";
    const player = {
        boxes: [assetPath ? new URL(assetPath, location.origin + "/").searchParams.get("box") : "", notebook].filter(Boolean),
        close: () => {
            abort.abort();
            cancelPreview(sessionID);
            video.pause();
            video.removeAttribute("src");
            video.load();
            if (objectURL) {
                URL.revokeObjectURL(objectURL);
            }
            container.remove();
            activePlayers.delete(player);
        },
    };
    activePlayers.add(player);
    void (async () => {
        if (!assetPath) {
            throw new Error("Invalid Live Photo asset");
        }
        if (!incompatibleOriginals.has(assetPath)) {
            video.src = new URL(assetPath, location.origin + "/").href;
            video.muted = true;
            try {
                await playOriginal(video, abort.signal);
                video.currentTime = 0;
                video.muted = false;
                status.remove();
                return;
            } catch {
                abort.signal.throwIfAborted();
                video.pause();
                incompatibleOriginals.add(assetPath);
                if (incompatibleOriginals.size > 256) {
                    incompatibleOriginals.delete(incompatibleOriginals.values().next().value);
                }
            }
        }
        let started = await fetchSyncPost("/api/asset/startLivePhotoPreview", {path: assetPath, clientEncode: true}, undefined, false, abort.signal);
        if (started.code !== 0) {
            throw new Error("Live Photo preview unavailable");
        }
        sessionID = started.data.id;
        try {
            if (started.data.encode) {
                await encodePreview(started.data, abort.signal);
            }
        } catch {
            abort.signal.throwIfAborted();
            cancelPreview(sessionID);
            started = await fetchSyncPost("/api/asset/startLivePhotoPreview", {path: assetPath, clientEncode: false}, undefined, false, abort.signal);
            if (started.code !== 0) {
                throw new Error("Live Photo preview unavailable");
            }
            sessionID = started.data.id;
        }
        const response = await binaryPreview("/api/asset/getLivePhotoPreview", {id: sessionID}, abort.signal);
        const blob = await response.blob();
        abort.signal.throwIfAborted();
        objectURL = URL.createObjectURL(blob);
        video.src = objectURL;
        video.muted = false;
        status.remove();
        // iOS 可能要求新的手势，保留原生播放按钮供用户继续播放。
        void video.play().catch(() => {});
    })().catch(error => {
        cancelPreview(sessionID);
        video.pause();
        if (!abort.signal.aborted) {
            status.textContent = window.siyuan.languages.livePhotoPreviewUnavailable;
            console.warn("Live Photo preview failed", error);
        }
    });
    return player.close;
};
