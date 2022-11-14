const express = require("express");
const disasembler = require("evm-disasm-js");
const fs = require("fs");
const { readdir } = require("node:fs/promises");

const VM = require("./lib/vm");

const app = express();
const port = 3344;

// TODO
// TEMP: here we load the code
const bytesWithoutConstructor =
    "0x608060405234801561001057600080fd5b50600436106100365760003560e01c806357de26a41461003b578063d09de08a14610059575b600080fd5b610043610063565b604051610050919061009c565b60405180910390f35b61006161006c565b005b60008054905090565b600160005461007b91906100e6565b600081905550565b6000819050919050565b61009681610083565b82525050565b60006020820190506100b1600083018461008d565b92915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b60006100f182610083565b91506100fc83610083565b9250828201905080821115610114576101136100b7565b5b9291505056fea2646970667358221220b6ab24c13c6cda0b644dfc989c0d2a21c12611547602bde8a254f33c3598539b64736f6c63430008110033";
const bytes =
    "0x60806040526000805534801561001457600080fd5b50610150806100246000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c806357de26a41461003b578063d09de08a14610059575b600080fd5b610043610063565b604051610050919061009c565b60405180910390f35b61006161006c565b005b60008054905090565b600160005461007b91906100e6565b600081905550565b6000819050919050565b61009681610083565b82525050565b60006020820190506100b1600083018461008d565b92915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b60006100f182610083565b91506100fc83610083565b9250828201905080821115610114576101136100b7565b5b9291505056fea2646970667358221220b6ab24c13c6cda0b644dfc989c0d2a21c12611547602bde8a254f33c3598539b64736f6c63430008110033";

let currentByteCode = "";
let BYTECODE_INDEX = 1;

//console.log(disassember.serialize(disassembly));
//

const bytecodes = {};
let vm, disassembly, serialized, currentCodeSection;

const dbgState = {};

function changeCodeSection(index) {
    const codeStart = dbgState.disassembly.codeSections[index].start;
    const codeStartBytes = codeStart * 2;

    const fullByteCode = bytecodes[Object.keys(bytecodes)[BYTECODE_INDEX]];
    currentByteCode = "0x" + fullByteCode.substr(codeStartBytes);
    currentCodeSection = index;

    console.log("change section", index, "code start", codeStart);
    console.log(currentByteCode);
}

async function wrapper() {
    // Load all the bytecode from the list of samples
    const SAMPLES_BUILD_PATH = "../samples/build";
    try {
        const files = await readdir(SAMPLES_BUILD_PATH);
        for (const file of files) {
            //console.log(`${SAMPLES_BUILD_PATH}/${file}`);
            bytecodes[file] = fs.readFileSync(
                `${SAMPLES_BUILD_PATH}/${file}`,
                "utf-8"
            );
        }
    } catch (e) {
        console.error(e);
    }

    // Perform initial disassembly of the full bytecode
    {
        const fullByteCode =
            "0x" + bytecodes[Object.keys(bytecodes)[BYTECODE_INDEX]];
        dbgState.disassembly = disasembler.disassemble(fullByteCode);
        dbgState.serializedDisassembly = disasembler.serialize(
            dbgState.disassembly
        );
    }

    changeCodeSection(0);

    disassembly = disasembler.disassemble(currentByteCode);
    serialized = disasembler.serialize(disassembly);
    vm = new VM(currentByteCode);

    await vm.start();
}

wrapper();

app.get("/", (req, res) => {
    res.send("Hello World!");
});

app.get("/code/load", (req, res) => {
    res.send({ byteCode: currentByteCode, disassembly: serialized });
});

app.get("/code/changeSection/:section", (req, res) => {
    const section = parseInt(req.params.section);
    currentCodeSection = section;
    changeCodeSection(section);

    // After change section, must update the disasm and vm state
    // TODO: find a new function to automate this
    disassembly = disasembler.disassemble(currentByteCode);
    serialized = disasembler.serialize(disassembly);
    vm = new VM(currentByteCode);

    vm.start();

    res.send({});
});

app.get("/debugger/start", async (req, res) => {
    vm = new VM(currentByteCode);
    await vm.start();
    res.send({});
});

app.get("/debugger/step", async (req, res) => {
    const isEnd = await vm.step();
    res.send({});
});

app.get("/debugger/state", async (req, res) => {
    const state = vm.state();
    //console.log(state);

    const stack = state.stack.map((v) => v.toString(16));

    res.json({
        pc: state.pc,
        opcode: {
            name: state.opcode.name,
        },
        stack,
        memory: state.memory,
        memoryWordCount: state.memoryWordCount.toString(16),
    });
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
