export class AgentMessageQueue<T extends {id: string}> {
    private sessions = new Map<string, T[]>();
    private paused = new Set<string>();

    get(sessionID: string): T[] {
        return this.sessions.get(sessionID) || [];
    }

    add(sessionID: string, message: T) {
        this.sessions.set(sessionID, [...this.get(sessionID), message]);
    }

    prepend(sessionID: string, message: T) {
        this.sessions.set(sessionID, [message, ...this.get(sessionID)]);
    }

    remove(sessionID: string, id: string) {
        const messages = this.get(sessionID).filter(message => message.id !== id);
        if (messages.length > 0) {
            this.sessions.set(sessionID, messages);
        } else {
            this.sessions.delete(sessionID);
            this.paused.delete(sessionID);
        }
    }

    clear(sessionID: string) {
        this.sessions.delete(sessionID);
        this.paused.delete(sessionID);
    }

    pause(sessionID: string) {
        if (this.get(sessionID).length > 0) {
            this.paused.add(sessionID);
        }
    }

    resume(sessionID: string) {
        this.paused.delete(sessionID);
    }

    isPaused(sessionID: string): boolean {
        return this.paused.has(sessionID);
    }
}
