/*
    This is where the code is executed step by step
    https://github.com/ethereumjs/ethereumjs-monorepo/blob/6d23fd07290fb3217e3371b0c42425647e28e89c/packages/evm/src/interpreter.ts#L151
*/

const { Blockchain } = require("@ethereumjs/blockchain");
const { Chain, Common, Hardfork } = require("@ethereumjs/common");
const { EEI } = require("@ethereumjs/vm");
const { EVM } = require("@ethereumjs/evm");
const { DefaultStateManager } = require("@ethereumjs/statemanager");
const EventEmitter = require("events");
const { opcodesTable } = require("evm-disasm-js");

class WaitingGadget {
    constructor() {
        this.promise = new Promise((resolve) => {
            this.resolve = resolve;
        });
    }
}

class VM {
    constructor(code, disassembly) {
        this.vmReadyWaiter = new WaitingGadget();

        this.isStepping = true; // if true, the debugger will stop after each instruction
        this.eventEmitter = new EventEmitter();
        this.breakpoints = {};
        this.dynamicJumps = {};
        this.disassembly = disassembly;

        const wrapper = async () => {
            const common = new Common({
                chain: Chain.Mainnet,
                hardfork: Hardfork.London,
            });
            const stateManager = new DefaultStateManager();
            const blockchain = await Blockchain.create();
            const eei = new EEI(stateManager, common, blockchain);

            const evm = new EVM({
                common,
                eei,
            });

            this.evm = evm;
            this.vmReadyWaiter.resolve();

            // Validate the bytecode
            if (code.startsWith("0x")) code = code.substr(2);
            this.code = code;
        };

        wrapper();
    }

    async start() {
        await this.vmReadyWaiter.promise;

        const { evm } = this;

        this.afterStep = new WaitingGadget();
        this.dynamicJumps = {};

        evm.events.on("step", (data, end) => {
            const isBreakpoint = this.breakpoints[data.pc];
            if (isBreakpoint) {
                // Break code here
                this.isStepping = true;
                this.eventEmitter.emit("vm_breakpoint", { pc: data.pc });
            }

            if (this.isStepping) {
                this.currentStep = data;
                this.afterStep.resolve(data);

                /*
                console.log(
                    `${data.pc.toString(16)} Op: ${data.opcode.name}\tStack: ${
                        data.stack
                    }`
                );*/

                this.handleAfterStep();

                this.vmStepFunction = end;
                this.eventEmitter.emit("vm_step", "data");
            } else {
                end();
            }
        });

        evm.runCode({
            //code: Buffer.from(code.join(""), "hex"),
            code: Buffer.from(this.code, "hex"),
            gasLimit: BigInt(0xffff),
            //data: "0x57de26a4000000000000000000000000",
            //data: "0x23b872dd000000000000000000000000",
            // CORRECT
            data: Buffer.from("c2985578000000000000000000000000", "hex"),
        })
            .then((results) => {
                console.log(`Returned: ${results.returnValue.toString("hex")}`);
                console.log(`gasUsed: ${results.executionGasUsed.toString()}`);

                this.isEnd = true;

                if (this.isStepping) this.afterStep.resolve();

                this.eventEmitter.emit("vm_exit", {});
            })
            .catch(console.error);
    }

    handleAfterStep() {
        // TODO: remove this, test lookahead
        const LOOKAHEAD_STEPS = 8;
        const mini = new MiniInterpreter(
            Buffer.from(this.code, "hex"),
            this.currentStep.stack,
            this.currentStep.pc
        );

        for (let i = 0; i < LOOKAHEAD_STEPS; i++) {
            const previousPc = mini.pc;
            const result = mini.step();

            if (result.error) {
                // Check if we stopped on a JUMP opcode
                if (result.opcode == 0x56) {
                    //
                    /*console.log(
                            "Stopped lookahead on a JUMP to addr",
                            result.stack[result.stack.length - 1]
                        );*/
                    const jumpAddr = result.stack[result.stack.length - 1];

                    // Check if this addr is a valid jump
                    const target = mini.opcodes[jumpAddr];
                    if (target == 0x5b) {
                        // JUMPDEST
                        // TODO: Check if this is a dynamic jump or not
                        const staticJump =
                            this.disassembly.cache.jumpsByAddr[jumpAddr];
                        if (!staticJump) {
                            this.dynamicJumps[jumpAddr] = {
                                addr: parseInt(jumpAddr),
                                from: previousPc,
                                dynamic: true,
                            };
                        }
                    }
                }

                // When an opcode is unhandled, just end the execution here
                break;
            }
        }
    }

    async run() {
        // If the VM was stepping: unlock it
        this.vmStepFunction && this.vmStepFunction();

        // Disable stepping mode (useful when transitionning for "Step" to "Run")
        this.isStepping = false;
        this.afterStep = new WaitingGadget();
        this.vmStepFunction = null;
    }

    async step() {
        if (this.isStepping) {
            this.lastStepState = await this.afterStep.promise;

            if (this.isEnd) return true;

            this.afterStep = new WaitingGadget();
            this.vmStepFunction && this.vmStepFunction();
        }
        // TODO: toast copy
        //const evm2 = this.evm.copy();
    }

    state() {
        //console.log(Object.keys(this.lastStepState));
        //console.log(Object.keys(this.evm.eei._stateManager));

        return { ...this.currentStep, dynamicJumps: this.dynamicJumps };
    }

    addBreakpoint(addr) {
        this.breakpoints[addr] = true;
    }
}

// Small interpreter for stack based instructions
// Used for lookahead during dynamic jump analysis
// Exits when it doesn't know how to execute an instruction
// TODO: ideally we would like to use the same interpreter as the "VM" class
class MiniInterpreter {
    constructor(opcodes, stack, pc) {
        this.opcodes = opcodes;
        this.stack = stack;
        this.pc = pc;

        console.log("\nStart from", pc.toString(16));
    }

    step() {
        let opcode = this.opcodes[this.pc];
        let stack = this.stack.slice();

        console.log("pc", this.pc.toString(16), "op", opcode.toString(16));

        let advance = 1;
        let error = false;
        let result = {};

        //console.log("opcode", opcode.toString(16));
        if (opcode >= 0x90 && opcode <= 0x9f) {
            // SWAPX
            const n = opcode - 0x90 + 1;
            //console.log("SWAP", n);
            const old = stack[stack.length - n - 1];
            stack[stack.length - n - 1] = stack[stack.length - 1];
            stack[stack.length - 1] = old;
        } else if (opcode == 0x50) {
            // POP
            //console.log("POP");
            stack.pop();
        } else if (opcode >= 0x60 && opcode <= 0x7f) {
            // PUSHX
            const n = opcode - 0x60 + 1;
            //console.log("PUSH", n);

            const op = opcodesTable[opcode];
            const operandValue = op[2](this.opcodes, this.pc);
            stack.push(BigInt(operandValue));
            advance = 1 + n;
        } else if (opcode >= 0x80 && opcode <= 0x8f) {
            // DUPX
            const n = opcode - 0x80 + 1;
            //console.log("DUP", n);
            const elem = stack[stack.length - n];
            stack.push(elem);
        } else if (opcode == 0x5b) {
            // Skip JUMPDEST
            //console.log("JUMPDEST");
        } else {
            //console.log("Unhandled opcode", opcode.toString(16));
            error = true;
        }

        this.pc += advance;
        this.stack = stack;

        //console.log(this.stack);

        return {
            error,
            pc: this.pc,
            stack: this.stack,
            opcode,
        };
    }
}

module.exports = VM;
