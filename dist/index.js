"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lib_1 = require("./lib");
function default_1(snowpackConfig, options) {
    return {
        name: 'snowpack-plugin-ipfs',
        async optimize({ buildDirectory, log }) {
            await lib_1.spa2ipfs(Object.assign(Object.assign({}, options), { folderPath: buildDirectory }), log);
        },
    };
}
exports.default = default_1;
;
