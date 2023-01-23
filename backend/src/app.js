const fs = require("fs");
const args = require("args");
const path = require("path");
//const { readdir } = require("node:fs/promises");

const express = require("express");
const disassembler = require("evm-disasm-js");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 } = require("uuid");

const VM = require("./lib/vm");

const app = express();
const port = 3344; // TODO: configurable backend port

/*
    Define and parse command line arguments
*/
function readArgs() {
    args.option("input", "Debugger cconfiguration file");
    args.option(
        "root-dir",
        "Configuration files paths passed with --input will be loaded from <root-dir> if the path is relative."
    );

    const flags = args.parse(process.argv);
    if (!flags.input) {
        console.error(
            "Error, no input file. Use --input option to pass a debugger .json configuration file."
        );

        process.exit(1);
    }

    let inputFilePath = flags.input;
    let rootDir = flags.rootDir;

    if (!rootDir) rootDir = process.cwd();

    if (!path.isAbsolute(flags.input)) {
        inputFilePath = rootDir + "/" + flags.input;
    }

    console.log("Loading configuration file from", inputFilePath);

    return {
        inputFileDir: path.dirname(inputFilePath),
        inputFilePath,
        rootDir,
    };
}

const programArgs = readArgs();

function parseDebuggerInputFile(file) {
    try {
        const rawContent = fs.readFileSync(file);
        try {
            return JSON.parse(rawContent);
        } catch (e) {
            console.error("Could not parse input file", file);
            console.error(e);
            process.exit(1);
        }
    } catch (e) {
        console.error("Could not load file", file, "does not exist.");
        process.exit(1);
    }
}

const dbgConfig = parseDebuggerInputFile(programArgs.inputFilePath);

const dbgState = {
    calldata: "",
    fullByteCodeDisassembly: "",
    fullByteCodeDisassemblySerialized: "",
    currentByteCode: "",
    currentByteCodeDisassembly: null,
    vm: null,
};

const dbgCode = {
    fullByteCode: "", // Complete bytecode to debug
};

if (dbgConfig?.bytecode?.file) {
    const bytecodePath = `${programArgs.inputFileDir}/${dbgConfig.bytecode.file}`;

    console.log("Loading bytecode from", bytecodePath);
    dbgCode.fullByteCode = fs.readFileSync(bytecodePath, "utf-8");
    console.log(dbgCode.fullByteCode);
}

if (dbgConfig?.runtime?.calldata) {
    dbgState.calldata = dbgConfig.runtime.calldata;
}

function changeCodeSection(index) {
    const codeStart =
        dbgState.fullByteCodeDisassembly.codeSections[index].start;
    const codeStartBytes = codeStart * 2;

    dbgState.currentByteCode =
        "0x" + dbgCode.fullByteCode.substr(codeStartBytes);
    currentCodeSection = index;

    console.log("change section", index, "code start", codeStart);
    console.log(dbgState.currentByteCode);
}

async function createVM(code, disassembly, calldata) {
    dbgState.vm = new VM(code, disassembly, calldata);

    dbgState.vm.eventEmitter.on("vm_exit", (e) => {
        sendToClient({ type: "vm_exit" });
    });

    dbgState.vm.eventEmitter.on("vm_step", (e) => {
        sendToClient({ type: "vm_step" });
    });

    dbgState.vm.eventEmitter.on("vm_breakpoint", (e) => {
        sendToClient({ type: "vm_breakpoint", ...e });
    });

    await dbgState.vm.start();
}

async function _start() {
    // Perform initial disassembly of the full bytecode
    dbgState.fullByteCodeDisassembly = disassembler.disassemble(
        "0x" + dbgCode.fullByteCode
    );
    dbgState.fullByteCodeDisassemblySerialized = disassembler.serialize(
        dbgState.fullByteCodeDisassembly
    );

    changeCodeSection(0);

    dbgState.currentByteCodeDisassembly = disassembler.disassemble(
        dbgState.currentByteCode
    );

    dbgState.currentByteCodeDisassemblySerialized = disassembler.serialize(
        dbgState.currentByteCodeDisassembly
    );

    await createVM(
        dbgState.currentByteCode,
        dbgState.currentByteCodeDisassembly,
        dbgState.calldata
    );
}

_start();

app.get("/", (req, res) => {
    res.send("Hello World!");
});

app.get("/code/load", (req, res) => {
    res.send({
        byteCode: dbgState.currentByteCode,
        disassembly: dbgState.currentByteCodeDisassemblySerialized,
    });
});

app.get("/code/changeSection/:section", (req, res) => {
    const section = parseInt(req.params.section);
    currentCodeSection = section;
    changeCodeSection(section);

    // After change section, must update the disasm and vm state
    // TODO: find a new function to automate this
    dbgState.currentByteCodeDisassembly = disassembler.disassemble(
        dbgState.currentByteCode
    );
    dbgState.currentByteCodeDisassemblySerialized = disassembler.serialize(
        dbgState.currentByteCodeDisassembly
    );

    createVM(
        dbgState.currentByteCode,
        dbgState.currentByteCodeDisassembly,
        dbgState.calldata
    );

    res.send({});
});

app.get("/debugger/run", async (req, res) => {
    await dbgState.vm.run();
    res.send({});
});

app.get("/debugger/start", async (req, res) => {
    dbgState.currentByteCodeDisassembly = disassembler.disassemble(
        dbgState.currentByteCode
    );
    await createVM(
        dbgState.currentByteCode,
        dbgState.currentByteCodeDisassembly,
        dbgState.calldata
    );

    res.send({});
});

app.get("/debugger/step", async (req, res) => {
    const isEnd = await dbgState.vm.step();
    res.send({});
});

app.get("/debugger/state", async (req, res) => {
    const state = dbgState.vm.state();

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

let websocketServer;
const websocketClients = {};

function sendToClient(message) {
    const str = JSON.stringify(message);
    for (let id in websocketClients) {
        websocketClients[id].send(str);
    }
}

websocketServer = new WebSocketServer({ server });

const CLIENT_PING_INTERVAL = 10 * 1000; // ping clients every 10s
const CLIENT_ALIVE_CHECK_INTERVAL = 5 * 1000;
const CLIENT_DISCONNECTED_TIMEOUT = 15 * 1000;

async function dropClient(clientId) {
    if (!websocketClients[clientId]) return;

    console.log(
        "[Disconnect] dropping client",
        clientId,
        websocketClients[clientId]._clientIp
    );
    clearInterval(websocketClients[clientId]._clientPingRef);
    delete websocketClients[clientId];
}

setInterval(() => {
    const ts = Date.now();
    for (const clientId of Object.keys(websocketClients)) {
        if (
            ts - websocketClients[clientId]._clientLastPongTs >
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

websocketServer.on("connection", function connection(ws, req) {
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
    websocketClients[id] = ws;

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
