const express = require("express");
const disassembler = require("evm-disasm-js");
const fs = require("fs");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 } = require("uuid");
const { readdir } = require("node:fs/promises");
const args = require("args");

const VM = require("./lib/vm");

const app = express();
const port = 3344;

args.option("input", "Main configuration file").option(
    "root-dir",
    "Directory configuration files will be loaded from"
);

const flags = args.parse(process.argv);

console.log(flags);

let currentByteCode = "";
let wss;
const clients = {};

function sendToClient(message) {
    const str = JSON.stringify(message);
    for (let id in clients) {
        clients[id].send(str);
    }
}

let fullByteCode = "";
let vm, disassembly, serialized, currentCodeSection;

const dbgState = {};

// Load debugger config file
const rootDir = flags.rootDir || ".";
const dbgConfig = JSON.parse(fs.readFileSync(rootDir + "/" + flags.input));
let calldata = "";

if (flags.input) {
    if (dbgConfig?.bytecode?.file) {
        const bytecodePath = `${rootDir}/${dbgConfig.bytecode.file}`;

        console.log("Loading bytecode from", bytecodePath);
        fullByteCode = fs.readFileSync(bytecodePath, "utf-8");
        console.log(fullByteCode);
    }

    if (dbgConfig?.runtime?.calldata) {
        calldata = dbgConfig.runtime.calldata;
    }
}

function changeCodeSection(index) {
    const codeStart = dbgState.disassembly.codeSections[index].start;
    const codeStartBytes = codeStart * 2;

    currentByteCode = "0x" + fullByteCode.substr(codeStartBytes);
    currentCodeSection = index;

    console.log("change section", index, "code start", codeStart);
    console.log(currentByteCode);
}

async function createVM(code, disassembly, calldata) {
    vm = new VM(code, disassembly, calldata);

    vm.eventEmitter.on("vm_exit", (e) => {
        sendToClient({ type: "vm_exit" });
    });

    vm.eventEmitter.on("vm_step", (e) => {
        sendToClient({ type: "vm_step" });
    });

    vm.eventEmitter.on("vm_breakpoint", (e) => {
        sendToClient({ type: "vm_breakpoint", ...e });
    });

    await vm.start();
}

/*async function wrapper() {
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
        dbgState.disassembly = disassembler.disassemble(fullByteCode);
        dbgState.serializedDisassembly = disassembler.serialize(
            dbgState.disassembly
        );
    }

    changeCodeSection(0);

    disassembly = disassembler.disassemble(currentByteCode);
    serialized = disassembler.serialize(disassembly);
    await createVM(currentByteCode, disassembly);
}*/

//wrapper();

async function _start() {
    // Perform initial disassembly of the full bytecode
    dbgState.disassembly = disassembler.disassemble("0x" + fullByteCode);
    dbgState.serializedDisassembly = disassembler.serialize(
        dbgState.disassembly
    );

    changeCodeSection(0);

    disassembly = disassembler.disassemble(currentByteCode);
    serialized = disassembler.serialize(disassembly);
    await createVM(currentByteCode, disassembly, calldata);
}

_start();

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
    disassembly = disassembler.disassemble(currentByteCode);
    serialized = disassembler.serialize(disassembly);

    createVM(currentByteCode, disassembly, calldata);

    res.send({});
});

app.get("/debugger/run", async (req, res) => {
    await vm.run();
    res.send({});
});

app.get("/debugger/start", async (req, res) => {
    disassembly = disassembler.disassemble(currentByteCode);
    await createVM(currentByteCode, disassembly, calldata);

    res.send({});
});

app.get("/debugger/step", async (req, res) => {
    const isEnd = await vm.step();
    res.send({});
});

app.get("/debugger/state", async (req, res) => {
    const state = vm.state();

    const stack = state.stack.map((v) => v.toString(16));

    res.json({
        pc: state.pc,
        opcode: {
            name: state.opcode.name,
        },
        stack,
        memory: state.memory,
        memoryWordCount: state.memoryWordCount.toString(16),
        dynamicJumps: state.dynamicJumps,
        lookaheadTrace: state.lookaheadTrace,
    });
});

// Server start
// ------------
const server = app.listen(port, () => {
    console.log(`ethersight backend listening on port ${port}`);
});

wss = new WebSocketServer({ server });

const CLIENT_PING_INTERVAL = 10 * 1000; // ping clients every 10s
const CLIENT_ALIVE_CHECK_INTERVAL = 5 * 1000;
const CLIENT_DISCONNECTED_TIMEOUT = 15 * 1000;

async function dropClient(clientId) {
    if (!clients[clientId]) return;

    console.log(
        "[Disconnect] dropping client",
        clientId,
        clients[clientId]._clientIp
    );
    clearInterval(clients[clientId]._clientPingRef);
    delete clients[clientId];
}

setInterval(() => {
    const ts = Date.now();
    for (const clientId of Object.keys(clients)) {
        if (
            ts - clients[clientId]._clientLastPongTs >
            CLIENT_DISCONNECTED_TIMEOUT
        ) {
            dropClient(clientId);
        }
    }
}, CLIENT_ALIVE_CHECK_INTERVAL);

function onMessage(ws, message) {
    try {
        const decoded = JSON.parse(message);
        if (decoded.type === "PING") {
            ws.send(JSON.stringify({ type: "PONG" }));
        }
    } catch (e) {
        console.error(e);
    }
}

wss.on("connection", function connection(ws, req) {
    // Register client connection/socket
    const id = uuidv4();
    ws._clientId = id;
    ws._clientLastPongTs = Date.now();

    console.log("[Websocket] Client connected", id);

    const ip = (
        req.headers["x-forwarded-for"] ||
        req.socket.remoteAddress ||
        ""
    )
        .split(",")[0]
        .trim();
    ws._clientIp = ip || req.socket.remoteAddress;
    clients[id] = ws;

    // Handlers
    ws.on("message", (msg) => onMessage(ws, msg));
    ws.on("pong", () => {
        ws._clientLastPongTs = Date.now();
    });

    const pingRef = setInterval(() => {
        ws.ping(() => {});
    }, CLIENT_PING_INTERVAL);
    ws._clientPingRef = pingRef;

    ws.on("close", async function close() {
        dropClient(id);
    });
});
