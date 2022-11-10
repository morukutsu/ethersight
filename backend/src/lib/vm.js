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
        };

        wrapper();
    }

    async start() {
        await this.vmReadyWaiter.promise;

        const { evm } = this;

        const bytesWithoutConstructor =
            "0x608060405234801561001057600080fd5b50600436106100365760003560e01c806357de26a41461003b578063d09de08a14610059575b600080fd5b610043610063565b604051610050919061009c565b60405180910390f35b61006161006c565b005b60008054905090565b600160005461007b91906100e6565b600081905550565b6000819050919050565b61009681610083565b82525050565b60006020820190506100b1600083018461008d565b92915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b60006100f182610083565b91506100fc83610083565b9250828201905080821115610114576101136100b7565b5b9291505056fea2646970667358221220b6ab24c13c6cda0b644dfc989c0d2a21c12611547602bde8a254f33c3598539b64736f6c63430008110033";

        const bytes =
            "60806040526000805534801561001457600080fd5b50610150806100246000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c806357de26a41461003b578063d09de08a14610059575b600080fd5b610043610063565b604051610050919061009c565b60405180910390f35b61006161006c565b005b60008054905090565b600160005461007b91906100e6565b600081905550565b6000819050919050565b61009681610083565b82525050565b60006020820190506100b1600083018461008d565b92915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b60006100f182610083565b91506100fc83610083565b9250828201905080821115610114576101136100b7565b5b9291505056fea2646970667358221220b6ab24c13c6cda0b644dfc989c0d2a21c12611547602bde8a254f33c3598539b64736f6c63430008110033";

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
            code: Buffer.from(bytes, "hex"),
            gasLimit: BigInt(0xffff),
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
