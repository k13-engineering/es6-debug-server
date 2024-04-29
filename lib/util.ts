interface IGenericErrorResponse<T> {
    error: T
};

interface IGenericSuccessResponse {
    error: undefined;
};

type TMaybeError<T, U = Error> = (T & IGenericSuccessResponse) | (IGenericErrorResponse<U> & {
    [K in keyof T]?: undefined;
});

const dedupeStringArray = ({ array }: { array: string[] }) => {
    let result: string[] = [];

    array.forEach((item) => {
        if (!result.includes(item)) {
            result = [...result, item];
        }
    });

    return result;
};

export {
    dedupeStringArray
};

export type {
    TMaybeError
};
