const express = require("express");
const app = express();
const port = 3344;
const VM = require("./lib/vm");

let vm = new VM();
async function wrapper() {
    await vm.start();
}

wrapper();

app.get("/", (req, res) => {
    res.send("Hello World!");
});

app.get("/debugger/start", async (req, res) => {
    vm = new VM();
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
