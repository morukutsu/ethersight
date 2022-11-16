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

class WaitingGadget {
    constructor() {
        this.promise = new Promise((resolve) => {
            this.resolve = resolve;
        });
    }
}

class VM {
    constructor(code) {
        this.vmReadyWaiter = new WaitingGadget();

        this.isStepping = false; // if true, the debugger will stop after each instruction
        this.eventEmitter = new EventEmitter();
        this.breakpoints = {};

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

                console.log(
                    `${data.pc.toString(16)} Op: ${data.opcode.name}\tStack: ${
                        data.stack
                    }`
                );

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
    }

    state() {
        //console.log(Object.keys(this.lastStepState));
        //console.log(Object.keys(this.evm.eei._stateManager));

        return { ...this.currentStep };
    }

    addBreakpoint(addr) {
        this.breakpoints[addr] = true;
    }
}

module.exports = VM;
