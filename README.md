# Ethersight

Ethereum VM (EVM) Debugger.

Provides an execution and debugging environment for EVM Bytecode in a Web GUI.

![Ethersight UI](docs/screenshot_1.png)

Goals:

-   Code analysis for bytecode generated from solc
-   Debugging UX designed for real debugging use-cases

TODO:

-   Load Ethereum state from a node (or file)
-   Step backward
-   Breakpoints UI
-   and more...

## Usage

As the project evolves, the install steps will be simplified.

### 0. Install dependencies

```
# 1. Use script
./install-ethersight.sh

# 2. Or install dependencies manually
cd backend
npm install

cd frontend
npm install
```

### 1. Config file

Instances of the debugger are created using config files, for example:

```
{
    "bytecode": {
        "file": "sample_bytecode.hex"
    },
    "runtime": {
        "calldata": "0xc2985578000000000000000000000000"
    }
}
```

### 2. Run the debugger

Use the script to start the debugger:

```
./start-ethersight.sh input.json
# Open browser to http://localhost:3000
```
