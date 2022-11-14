/*
    This is where the code is executed step by step
    https://github.com/ethereumjs/ethereumjs-monorepo/blob/6d23fd07290fb3217e3371b0c42425647e28e89c/packages/evm/src/interpreter.ts#L151
*/

const { Blockchain } = require("@ethereumjs/blockchain");
const { Chain, Common, Hardfork } = require("@ethereumjs/common");
const { EEI } = require("@ethereumjs/vm");
const { EVM } = require("@ethereumjs/evm");
const { DefaultStateManager } = require("@ethereumjs/statemanager");

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
            this.currentStep = data;
            this.afterStep.resolve(data);

            console.log(
                `${data.pc.toString(16)} Op: ${data.opcode.name}\tStack: ${
                    data.stack
                }`
            );

            this.vmStepFunction = end;
        });

        evm.runCode({
            //code: Buffer.from(code.join(""), "hex"),
            code: Buffer.from(this.code, "hex"),
            gasLimit: BigInt(0xffff),
            //data: "0x57de26a4000000000000000000000000",
            //data: "0x23b872dd000000000000000000000000",
            // CORRECT
            //data: Buffer.from("57de26a4000000000000000000000000", "hex"),
        })
            .then((results) => {
                console.log(`Returned: ${results.returnValue.toString("hex")}`);
                console.log(`gasUsed: ${results.executionGasUsed.toString()}`);

                this.isEnd = true;
                this.afterStep.resolve();
            })
            .catch(console.error);
    }

    async step() {
        this.lastStepState = await this.afterStep.promise;

        if (this.isEnd) return true;

        this.afterStep = new WaitingGadget();
        this.vmStepFunction && this.vmStepFunction();
    }

    state() {
        //console.log(Object.keys(this.lastStepState));
        //console.log(Object.keys(this.evm.eei._stateManager));

        return { ...this.currentStep };
    }
}

module.exports = VM;
