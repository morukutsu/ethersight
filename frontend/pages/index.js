import Head from "next/head";
import styles from "../styles/Home.module.css";
import disasembler from "evm-disasm-js";
import monokai from "../monokai.json";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const bytesWithoutConstructor =
    "0x608060405234801561001057600080fd5b50600436106100365760003560e01c806357de26a41461003b578063d09de08a14610059575b600080fd5b610043610063565b604051610050919061009c565b60405180910390f35b61006161006c565b005b60008054905090565b600160005461007b91906100e6565b600081905550565b6000819050919050565b61009681610083565b82525050565b60006020820190506100b1600083018461008d565b92915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b60006100f182610083565b91506100fc83610083565b9250828201905080821115610114576101136100b7565b5b9291505056fea2646970667358221220b6ab24c13c6cda0b644dfc989c0d2a21c12611547602bde8a254f33c3598539b64736f6c63430008110033";

const disassembly = disasembler.disassemble(bytesWithoutConstructor);

let cTheme = {};
for (const e of monokai.tokenColors) {
    cTheme[e.name] = e?.settings?.foreground;
}

function DisassemblyEmptyLine() {
    return <div className="mb-3"></div>;
}

function DisassemblyLineLabel(props) {
    const { name } = props;

    return <div style={{ color: cTheme["Function name"] }}>{name}:</div>;
}

function byteToHex(byte) {
    let out = byte.toString(16);
    if (out.length === 1) out = "0" + out;
    return out;
}

function getOpcodeColor(bytecode) {
    if (bytecode === 0x56 || bytecode === 0x57) {
        return cTheme["Template Definition"];
    } else if (bytecode === 0x5b) {
        return cTheme["Comment"];
    }

    return "#FFFFFF";
}

const renderedLinesCache = {
    positions: {},
};

function DisassemblyLineOpcode(props) {
    const { opcode } = props;
    const ref = useRef();

    const addrDisplay = `0x${opcode.addr.toString(16)}`;
    const opcodeDisplay = opcode.opcode || byteToHex(opcode.bytecode);
    const operandDisplay =
        opcode.operandValue && `0x${opcode.operandValue.toString(16)}`;
    const opcodeColor = getOpcodeColor(opcode.bytecode);

    useLayoutEffect(() => {
        if (ref.current) {
            const rect = ref.current.getBoundingClientRect();
            renderedLinesCache.positions[opcode.addr] = {
                top: rect.top + window.scrollY + rect.height / 2,
                height: rect.height,
            };
        }
    });

    return (
        <div ref={ref} className="hover:bg-slate-400">
            <span className="mr-4" style={{ color: cTheme["Comment"] }}>
                {addrDisplay}
            </span>
            <span style={{ color: opcodeColor }}>{opcodeDisplay}</span>
            {operandDisplay && (
                <span className="ml-2" style={{ color: cTheme["Number"] }}>
                    {operandDisplay}
                </span>
            )}
        </div>
    );
}

function DisassemblyEnd(props) {
    const ref = useRef();

    useLayoutEffect(() => {
        props.onDisassemblyEnd();
    });

    return <div ref={ref} />;
}

function DisassemblyJumps(props) {
    const [jumps, setJumps] = useState({});
    renderedLinesCache.setJumps = setJumps;

    function getOpcodeByAddr(addr) {
        const idx = disassembly.opcodes.findIndex((e) => e.addr == addr);
        return disassembly.opcodes[idx];
    }

    function renderJumps() {
        // Try to place jumps on columns
        const columns = [[]];

        function overlap(j1, j2) {
            return j1.y2 > j2.y1 && j2.y2 > j1.y1;
        }

        function addJump(j1) {
            function findSpaceOnColumn(columnIndex) {
                if (columnIndex >= columns.length) {
                    columns.push([]);
                }

                const column = columns[columnIndex];

                for (const j2 of column) {
                    // Check if the new element overlaps something on the column
                    if (overlap(j1, j2)) {
                        // If overlap, try to find space on the next column
                        return false;
                    }
                }

                return true;
            }

            let added = false;
            let columnIndex = 0;
            while (!added) {
                if (findSpaceOnColumn(columnIndex)) {
                    const column = columns[columnIndex];
                    column.push(j1);
                    added = true;
                } else {
                    columnIndex++;
                }
            }
        }

        // To avoid displaying overlapping horizontal lines, keep track of which ones overlaps
        const horizontalOverlapsAtYPosition = {};

        for (let i = 0; i < disassembly.jumps.length; i++) {
            const jump = disassembly.jumps[i];
            const opFrom1 = getOpcodeByAddr(jump.from);
            const opDest1 = getOpcodeByAddr(jump.addr);
            const f1 = jumps[opFrom1.addr];
            const d1 = jumps[opDest1.addr];

            if (f1 && d1) {
                let ay1 = f1.top < d1.top ? f1.top : d1.top;
                let ay2 = ay1 + Math.abs(d1.top - f1.top);

                if (horizontalOverlapsAtYPosition[ay2] === undefined)
                    horizontalOverlapsAtYPosition[ay2] = 0;
                else horizontalOverlapsAtYPosition[ay2]++;

                if (horizontalOverlapsAtYPosition[ay1] === undefined)
                    horizontalOverlapsAtYPosition[ay1] = 0;
                else horizontalOverlapsAtYPosition[ay1]++;

                const jumpDrawInfo = { y1: ay1, y2: ay2, jump };
                addJump(jumpDrawInfo);
            }
        }

        ///
        ////
        ////
        ///

        // TODO: jump should be rerendered only when all opcodes have been rendered
        let currentX = 0;
        let COLUMN_SIZE = 16;
        let maxSize = columns.length * COLUMN_SIZE;

        const elements = [];
        const horizontalOverlapCounters = {};

        let columnIndex = 0;
        for (const column of columns) {
            for (const jump of column) {
                let yOffset = 0;

                // Offset the vertical position of an horizontal line if there is an overlap
                if (horizontalOverlapsAtYPosition[jump.y1]) {
                    if (!horizontalOverlapCounters[jump.y1])
                        horizontalOverlapCounters[jump.y1] = 0;
                    yOffset = horizontalOverlapCounters[jump.y1];
                    horizontalOverlapCounters[jump.y1] += 2;
                } else if (horizontalOverlapsAtYPosition[jump.y2]) {
                    if (!horizontalOverlapCounters[jump.y2])
                        horizontalOverlapCounters[jump.y2] = 0;
                    yOffset = horizontalOverlapCounters[jump.y2];
                    horizontalOverlapCounters[jump.y2] += 2;
                }

                // Vertical lines
                elements.push(
                    <div
                        style={{
                            position: "absolute",
                            width: 1,
                            height: jump.y2 - jump.y1,
                            backgroundColor: cTheme["Function name"],
                            top: jump.y1 + yOffset,
                            left: maxSize - currentX - COLUMN_SIZE,
                        }}
                    ></div>
                );

                // Horizontal lines
                elements.push(
                    <div
                        style={{
                            position: "absolute",
                            width:
                                (columnIndex + 1) * COLUMN_SIZE -
                                COLUMN_SIZE / 2,
                            height: 1,
                            backgroundColor: cTheme["Function name"],
                            top: jump.y1 + yOffset,
                            left: maxSize - currentX - COLUMN_SIZE,
                        }}
                    ></div>
                );

                elements.push(
                    <div
                        style={{
                            position: "absolute",
                            width:
                                (columnIndex + 1) * COLUMN_SIZE -
                                COLUMN_SIZE / 2,
                            height: 1,
                            backgroundColor: cTheme["Function name"],
                            top: jump.y2 + yOffset,
                            left: maxSize - currentX - COLUMN_SIZE,
                        }}
                    ></div>
                );
            }

            currentX += 16;
            columnIndex++;
        }

        return <div style={{ width: maxSize }}>{elements}</div>;
    }

    return <div>{renderJumps()}</div>;
}

function DisassemblyView(props) {
    const { disassembly } = props;
    const [index, setIndex] = useState(0);

    function handleDisassemblyEnd() {
        console.log("Disasm end");

        /*for (const addr of Object.keys(renderedLinesCache.positions)) {
            const e = renderedLinesCache.positions[addr];
        }*/

        renderedLinesCache.setJumps(renderedLinesCache.positions);
        //setIndex((prev) => prev + 1);
    }

    function renderDisassembly() {
        const elements = [];

        const functionsByAddr = {};
        for (const func of disassembly.functions) {
            functionsByAddr[func.addr] = func;
        }

        for (const e of disassembly.opcodes) {
            const label = disassembly.labels[e.addr];
            const func = functionsByAddr[e.addr];

            if (func) {
                elements.push(<DisassemblyEmptyLine />);
                elements.push(<DisassemblyLineLabel name={func.name} />);
            } else if (label) {
                elements.push(<DisassemblyEmptyLine />);
                elements.push(<DisassemblyLineLabel name={label.name} />);
            }

            elements.push(<DisassemblyLineOpcode opcode={e} />);
        }

        elements.push(
            <DisassemblyEnd onDisassemblyEnd={handleDisassemblyEnd} />
        );

        return elements;
    }

    return (
        <div className="flex">
            <div>
                <DisassemblyJumps disassembly={disassembly} />
            </div>
            <div className="font-mono text-sm text-white overflow-y-auto h-full">
                {renderDisassembly()}
            </div>
        </div>
    );
}

export default function Home() {
    return (
        <div className={styles.container}>
            <Head>
                <title>ethersight</title>
                <meta
                    name="description"
                    content="Generated by create next app"
                />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <div className="bg-black w-screen h-screen">
                <DisassemblyView disassembly={disassembly}></DisassemblyView>
            </div>
        </div>
    );
}
