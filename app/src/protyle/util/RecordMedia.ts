const SAMPLE_RATE = 44100;
const MP3_BIT_RATE = 96;
const BUFFER_SIZE = 2048;

type EncoderMessage =
    { type: "ready" } |
    { type: "chunk", buffer: ArrayBuffer } |
    { type: "finished" } |
    { type: "error", message: string };

export class RecordMedia {
    public isRecording = false;
    public onerror?: (error: Error) => void;

    private readonly context: AudioContext;
    private readonly mediaStream: MediaStream;
    private readonly audioInput: MediaStreamAudioSourceNode;
    private readonly recorder: ScriptProcessorNode;
    private worker: Worker;
    private chunks: ArrayBuffer[] = [];
    private readyPromise: Promise<void>;
    private resolveReady: () => void;
    private rejectReady: (error: Error) => void;
    private stopPromise: Promise<Blob>;
    private resolveStop: (blob: Blob) => void;
    private rejectStop: (error: Error) => void;
    private disposed = false;

    constructor(mediaStream: MediaStream) {
        this.mediaStream = mediaStream;
        const AudioContextConstructor = typeof AudioContext !== "undefined" ? AudioContext : webkitAudioContext;
        if (!AudioContextConstructor) {
            throw new Error("AudioContext is not supported");
        }

        this.context = new AudioContextConstructor({sampleRate: SAMPLE_RATE});
        this.audioInput = this.context.createMediaStreamSource(mediaStream);
        this.recorder = this.context.createScriptProcessor(BUFFER_SIZE, 1, 1);
        this.recorder.onaudioprocess = (event: AudioProcessingEvent) => {
            if (!this.isRecording || !this.worker) {
                return;
            }
            const input = event.inputBuffer.getChannelData(0);
            const pcm = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
                const sample = Math.max(-1, Math.min(1, input[i]));
                pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            }
            this.worker.postMessage({type: "encode", buffer: pcm.buffer}, [pcm.buffer]);
        };
        this.audioInput.connect(this.recorder);
        this.recorder.connect(this.context.destination);
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
        await this.readyPromise;
        await this.context.resume();
        this.isRecording = true;
    }

    public stopRecording() {
        if (this.stopPromise) {
            return this.stopPromise;
        }
        if (!this.isRecording || !this.worker) {
            return Promise.reject(new Error("Recorder is not recording"));
        }

        this.isRecording = false;
        this.stopPromise = new Promise<Blob>((resolve, reject) => {
            this.resolveStop = resolve;
            this.rejectStop = reject;
        });
        this.worker.postMessage({type: "finish"});
        return this.stopPromise;
    }

    public dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.isRecording = false;
        this.recorder.onaudioprocess = null;
        this.audioInput.disconnect();
        this.recorder.disconnect();
        this.worker?.terminate();
        this.worker = undefined;
        this.mediaStream.getTracks().forEach((track) => track.stop());
        if (this.context.state !== "closed") {
            this.context.close();
        }
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
        this.isRecording = false;
        this.rejectReady?.(error);
        this.rejectStop?.(error);
        this.onerror?.(error);
    }
}
