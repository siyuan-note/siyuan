import * as fs from "node:fs/promises";
import {createMarkdownInstanceId} from "../../src/markdown/identity";
import type {MarkdownIOError} from "./types";

// The caller owns and may clean up the path only after exclusive creation
// succeeds. A collision must never cause somebody else's file to be removed.
export const createMarkdownTemporaryFile = async (prefix: string, mode: number,
    io: Pick<typeof fs, "open"> = fs, createId = createMarkdownInstanceId): Promise<{path: string; handle: fs.FileHandle}> => {
    for (let attempt = 0; ; attempt++) {
        const path = prefix + createId() + ".tmp";
        try {
            return {path, handle: await io.open(path, "wx", mode)};
        } catch (caught) {
            const error = caught as MarkdownIOError;
            if (error.code !== "EEXIST" || attempt === 7) throw error;
        }
    }
};
