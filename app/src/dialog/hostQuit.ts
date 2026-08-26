export const createHostQuitGuard = () => {
    let started = false;

    return {
        isStarted: () => started,
        run(action: () => void) {
            if (started) {
                return false;
            }
            started = true;
            try {
                action();
                return true;
            } catch (error) {
                started = false;
                throw error;
            }
        },
    };
};
