const solc = require("solc");
const fs = require("fs");
const { readdir } = require("node:fs/promises");

const SAMPLES_PATH = "./solidity";
const BUILD_PATH = "./build";

async function main() {
    if (!fs.existsSync(BUILD_PATH)) fs.mkdirSync(BUILD_PATH);

    try {
        const files = await readdir(SAMPLES_PATH);
        for (const file of files) {
            const path = `${SAMPLES_PATH}/${file}`;
            const content = fs.readFileSync(path, "utf-8");

            const input = {
                language: "Solidity",
                sources: {
                    [file]: {
                        content,
                    },
                },
                settings: {
                    outputSelection: {
                        "*": {
                            "*": ["*"],
                        },
                    },
                },
            };

            console.log("Compiling:", file, "...");
            const outputBytecodePath = `${BUILD_PATH}/${file}.hex`;

            const output = JSON.parse(solc.compile(JSON.stringify(input)));
            if (output.errors) {
                for (const e of output.errors) console.log(e.formattedMessage);

                if (fs.existsSync(outputBytecodePath))
                    fs.rmSync(outputBytecodePath);

                continue;
            }

            // Assuming there is one contract per file, for now
            let byteCode;
            for (let contractName in output.contracts[file]) {
                /*console.log(
                    contractName +
                        ": " +
                        output.contracts[file][contractName].evm.bytecode.object
                );*/

                console.log(output.contracts[file][contractName].evm.assembly);

                byteCode =
                    output.contracts[file][contractName].evm.bytecode.object;

                break;
            }

            if (byteCode) {
                fs.writeFileSync(outputBytecodePath, byteCode);
            }
        }
    } catch (err) {
        console.error(err);
    }
}

main();
