/*! MP3 编码使用 @breezystack/lamejs，许可证为 LGPL-3.0：https://github.com/shijinyu/lamejs */
import {Mp3Encoder} from "@breezystack/lamejs";

type WorkerMessage =
    { type: "init", sampleRate: number, bitRate: number } |
    { type: "encode", buffer: ArrayBuffer } |
    { type: "finish" };

type WorkerScope = {
    onmessage: (event: MessageEvent<WorkerMessage>) => void;
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const workerScope = globalThis as unknown as WorkerScope;
let encoder: Mp3Encoder;

const postChunk = (chunk: Uint8Array) => {
    if (chunk.length === 0) {
        return;
    }
    const buffer = chunk.slice().buffer;
    workerScope.postMessage({type: "chunk", buffer}, [buffer]);
};

workerScope.onmessage = (event: MessageEvent<WorkerMessage>) => {
    try {
        const message = event.data;
        if (message.type === "init") {
            encoder = new Mp3Encoder(1, message.sampleRate, message.bitRate);
            workerScope.postMessage({type: "ready"});
        } else if (message.type === "encode") {
            if (!encoder) {
                throw new Error("MP3 encoder is not initialized");
            }
            postChunk(encoder.encodeBuffer(new Int16Array(message.buffer)));
        } else if (message.type === "finish") {
            if (!encoder) {
                throw new Error("MP3 encoder is not initialized");
            }
            postChunk(encoder.flush());
            encoder = undefined;
            workerScope.postMessage({type: "finished"});
        }
    } catch (error) {
        workerScope.postMessage({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
        });
    }
};
