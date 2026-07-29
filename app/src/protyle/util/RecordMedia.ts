import {isInAndroid, isInHarmony} from "./compatibility";

const MP3_BIT_RATE = 96;
const BUFFER_SIZE = 2048;
const PROCESSOR_NAME = "siyuan-record-media";
const PROCESSOR_SOURCE = `
class RecordMediaProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Int16Array(${BUFFER_SIZE});
        this.offset = 0;
        this.recording = false;
        this.port.onmessage = (event) => {
            if (event.data.type === "start") {
                this.recording = true;
            } else if (event.data.type === "stop") {
                this.recording = false;
                this.flush();
                this.port.postMessage({type: "flushed"});
            }
        };
    }

    flush() {
        if (this.offset === 0) {
            return;
        }
        const chunk = this.buffer.slice(0, this.offset);
        this.buffer = new Int16Array(${BUFFER_SIZE});
        this.offset = 0;
        this.port.postMessage({type: "chunk", buffer: chunk.buffer}, [chunk.buffer]);
    }

    process(inputs) {
        if (!this.recording || !inputs[0] || !inputs[0][0]) {
            return true;
        }
        const input = inputs[0][0];
        for (let i = 0; i < input.length; i++) {
            const sample = Math.max(-1, Math.min(1, input[i]));
            this.buffer[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            if (this.offset === this.buffer.length) {
                this.flush();
            }
        }
        return true;
    }
}
registerProcessor("${PROCESSOR_NAME}", RecordMediaProcessor);
`;

type EncoderMessage =
    { type: "ready" } |
    { type: "chunk", buffer: ArrayBuffer } |
    { type: "finished" } |
    { type: "error", message: string };

type ProcessorMessage =
    { type: "chunk", buffer: ArrayBuffer } |
    { type: "flushed" };

export class RecordMediaInputEndedError extends Error {
    constructor() {
        super("Audio input ended");
        this.name = "RecordMediaInputEndedError";
    }
}

export class RecordMedia {
    public isRecording = false;
    public onerror?: (error: Error) => void;

    private readonly context: AudioContext;
    private readonly mediaStream: MediaStream;
    private readonly audioInput: MediaStreamAudioSourceNode;
    private recorder: AudioWorkletNode;
    private worker: Worker;
    private chunks: ArrayBuffer[] = [];
    private readyPromise: Promise<void>;
    private resolveReady: () => void;
    private rejectReady: (error: Error) => void;
    private stopPromise: Promise<Blob>;
    private resolveStop: (blob: Blob) => void;
    private rejectStop: (error: Error) => void;
    private disposed = false;
    private failure: Error;
    private readonly handleTrackEnded = () => {
        this.handleWorkerError(new RecordMediaInputEndedError());
    };

    constructor(mediaStream: MediaStream) {
        this.mediaStream = mediaStream;
        const AudioContextConstructor = typeof AudioContext !== "undefined" ? AudioContext : webkitAudioContext;
        if (!AudioContextConstructor) {
            throw new Error("AudioContext is not supported");
        }

        const contextOptions = {} as AudioContextOptions & { sinkId?: { type: "none" } };
        if ((isInAndroid() || isInHarmony()) && "setSinkId" in AudioContextConstructor.prototype) {
            contextOptions.sinkId = {type: "none"};
        }
        this.context = new AudioContextConstructor(contextOptions);
        if (!this.context.audioWorklet || typeof AudioWorkletNode === "undefined") {
            throw new Error("AudioWorklet is not supported");
        }
        this.audioInput = this.context.createMediaStreamSource(mediaStream);
        this.mediaStream.getAudioTracks().forEach((track) => {
            track.addEventListener("ended", this.handleTrackEnded);
        });
    }

    public async startRecording() {
        if (this.disposed) {
            throw new Error("Recorder has been disposed");
        }
        if (this.isRecording) {
            return;
        }

        this.chunks = [];
        this.readyPromise = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        // Webpack 通过 import.meta.url 将录音编码器打包为按需加载的独立 Worker。
        // @ts-ignore TypeScript 的 CommonJS 类型检查不识别由 Webpack 转换的 import.meta.url。
        this.worker = new Worker(new URL("./RecordMediaWorker.ts", import.meta.url));
        this.worker.onmessage = (event: MessageEvent<EncoderMessage>) => {
            this.handleWorkerMessage(event.data);
        };
        this.worker.onerror = (event: ErrorEvent) => {
            this.handleWorkerError(new Error(event.message || "MP3 encoder failed"));
        };
        this.worker.postMessage({
            type: "init",
            sampleRate: this.context.sampleRate,
            bitRate: MP3_BIT_RATE,
        });
        await Promise.all([this.readyPromise, this.initializeRecorder()]);
        if (this.failure) {
            throw this.failure;
        }
        await this.context.resume();
        if (this.failure) {
            throw this.failure;
        }
        this.isRecording = true;
        this.recorder.port.postMessage({type: "start"});
    }

    public stopRecording() {
        if (this.stopPromise) {
            return this.stopPromise;
        }
        if (!this.isRecording || !this.worker || !this.recorder) {
            return Promise.reject(new Error("Recorder is not recording"));
        }

        this.isRecording = false;
        this.stopPromise = new Promise<Blob>((resolve, reject) => {
            this.resolveStop = resolve;
            this.rejectStop = reject;
        });
        this.recorder.port.postMessage({type: "stop"});
        return this.stopPromise;
    }

    public dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.isRecording = false;
        this.recorder?.port.close();
        this.recorder?.disconnect();
        this.recorder = undefined;
        this.audioInput.disconnect();
        this.worker?.terminate();
        this.worker = undefined;
        this.mediaStream.getAudioTracks().forEach((track) => {
            track.removeEventListener("ended", this.handleTrackEnded);
        });
        this.mediaStream.getTracks().forEach((track) => track.stop());
        if (this.context.state !== "closed") {
            this.context.close();
        }
    }

    private async initializeRecorder() {
        const processorURL = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], {type: "text/javascript"}));
        try {
            await this.context.audioWorklet.addModule(processorURL);
        } finally {
            URL.revokeObjectURL(processorURL);
        }
        if (this.disposed) {
            throw new Error("Recorder has been disposed");
        }

        this.recorder = new AudioWorkletNode(this.context, PROCESSOR_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 0,
        });
        this.recorder.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
            if (event.data.type === "chunk" && this.worker) {
                this.worker.postMessage({type: "encode", buffer: event.data.buffer}, [event.data.buffer]);
            } else if (event.data.type === "flushed" && this.worker) {
                this.worker.postMessage({type: "finish"});
            }
        };
        this.recorder.onprocessorerror = () => {
            this.handleWorkerError(new Error("Audio processor failed"));
        };
        this.audioInput.connect(this.recorder);
    }

    private handleWorkerMessage(message: EncoderMessage) {
        if (message.type === "ready") {
            this.resolveReady?.();
        } else if (message.type === "chunk") {
            this.chunks.push(message.buffer);
        } else if (message.type === "finished") {
            this.resolveStop?.(new Blob(this.chunks, {type: "audio/mpeg"}));
        } else if (message.type === "error") {
            this.handleWorkerError(new Error(message.message));
        }
    }

    private handleWorkerError(error: Error) {
        if (this.disposed || this.failure) {
            return;
        }
        this.failure = error;
        this.isRecording = false;
        this.rejectReady?.(error);
        this.rejectStop?.(error);
        this.onerror?.(error);
    }
}
