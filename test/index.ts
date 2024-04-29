import { create as createNodeTestRunner } from "../../ya-test-library/lib/runners/node-test.ts";
import { serverTestGroup } from "./server/index.ts";

const runner = createNodeTestRunner();
runner.run({
    group: {
        tests: {
            server: serverTestGroup,
        }
    },
});
