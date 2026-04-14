type TTryReadErrorCode = "FILE_NOT_FOUND" | "IO_ERROR";

type TTryReadError = Error & {
    readErrorCode?: TTryReadErrorCode;
};

const createReadError = ({ code, message, cause }: { code: TTryReadErrorCode, message: string, cause?: Error }): TTryReadError => {
    const error: TTryReadError = Error(message, { cause });
    error.readErrorCode = code;
    return error;
};

export {
    createReadError
};

export type {
    TTryReadError,
    TTryReadErrorCode
};
