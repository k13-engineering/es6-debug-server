import debugModule from "debug";

const createLogger = ({ name } : { name: string }) => {
    return debugModule(`es6-debug-server.${name}`);
};

export {
    createLogger
};
