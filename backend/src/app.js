const express = require("express");
const disasembler = require("evm-disasm-js");
const fs = require("fs");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 } = require("uuid");

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
let wss;
const clients = {};

function sendToClient(message) {
    const str = JSON.stringify(message);
    for (let id in clients) {
        clients[id].send(str);
    }
}

//console.log(disassember.serialize(disassembly));
//

const bytecodes = {};
let vm, disassembly, serialized, currentCodeSection;

const dbgState = {};

const events = [];

class WaitingGadget {
    constructor() {
        this.promise = new Promise((resolve) => {
            this.resolve = resolve;
        });
    }
}

let pendingEvent = new WaitingGadget();

function addEvent(event) {
    events.push(event);
    pendingEvent.resolve();
    pendingEvent = new WaitingGadget();
}

function changeCodeSection(index) {
    const codeStart = dbgState.disassembly.codeSections[index].start;
    const codeStartBytes = codeStart * 2;

    const fullByteCode = bytecodes[Object.keys(bytecodes)[BYTECODE_INDEX]];
    currentByteCode = "0x" + fullByteCode.substr(codeStartBytes);
    currentCodeSection = index;

    console.log("change section", index, "code start", codeStart);
    console.log(currentByteCode);
}

async function createVM(code) {
    vm = new VM(code);

    vm.eventEmitter.on("vm_exit", (e) => {
        sendToClient({ type: "vm_exit" });
    });

    vm.eventEmitter.on("vm_step", (e) => {
        sendToClient({ type: "vm_step" });
    });

    vm.eventEmitter.on("vm_breakpoint", (e) => {
        sendToClient({ type: "vm_breakpoint", ...e });
    });

    vm.addBreakpoint(0x4c);

    await vm.start();
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
    await createVM(currentByteCode);
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
    createVM(currentByteCode);

    res.send({});
});

app.get("/debugger/run", async (req, res) => {
    await vm.run();
    res.send({});
});

app.get("/debugger/start", async (req, res) => {
    await createVM(currentByteCode);

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

// Server start
// ------------
const server = app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
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
