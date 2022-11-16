import mitt from "mitt";

const WS_URI = "ws://localhost:3344";

let handle = {
    uri: null,
    isConnected: false,
    emitter: mitt(),
    sock: null,
    lastPongTs: 0,
    auth: false,
};

let _connectionLockResolve = null;
let _connectionLock = new Promise((resolve) => {
    _connectionLockResolve = resolve;
});

let offlineMessageBuffer = [];

function websocketMessageHandler(event) {
    const { data } = event;

    try {
        const parsed = JSON.parse(data);
        if (parsed) {
            if (parsed.type === "PONG") {
                handle.lastPongTs = Date.now();
            } else {
                handle.emitter.emit("message", parsed);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function connect(location) {
    return new Promise((resolve, reject) => {
        const sock = new WebSocket(location);

        sock.onopen = function (event) {
            resolve(sock);
        };

        sock.onerror = function (event) {
            reject(null);
        };
    });
}

async function connectWebsocket() {
    handle.uri = WS_URI;
    _connectionLockResolve();
}

function websocketIsConnected() {
    return handle.isConnected;
}

async function websocketLoop() {
    await _connectionLock;

    let retry = 0;
    while (retry < 1000) {
        try {
            const sock = await connect(handle.uri);
            handle.sock = sock;
            handle.isConnected = true;
            handle.emitter.emit("connect", {});
            retry = 0;

            let disconnectResolve = null;
            let disconnectLock = new Promise(
                (resolve) => (disconnectResolve = resolve)
            );

            sock.onclose = function (event) {
                handle.isConnected = false;
                disconnectResolve();
            };

            sock.onmessage = websocketMessageHandler;

            // Create ping handler
            const LIVENESS_DELAY = 30000;
            const PING_DELAY = 10000;

            let killPingHandler = false;
            async function pingHandler(socket) {
                handle.lastPongTs = 0;

                while (!killPingHandler) {
                    // Send ping request
                    const payload = {
                        type: "PING",
                        ping: {},
                    };

                    const message = JSON.stringify(payload);
                    socket.send(message);

                    // Check liveness
                    if (
                        handle.lastPongTs !== 0 &&
                        Date.now() - handle.lastPongTs > LIVENESS_DELAY
                    ) {
                        console.log("[Websocket] Connection seems down...");
                        socket.onclose = null;
                        socket.onmessage = null;
                        handle.isConnected = false;
                        socket.close();
                        disconnectResolve();
                        return;
                    }

                    await new Promise((resolve) =>
                        setTimeout(resolve, PING_DELAY)
                    );
                }
            }

            pingHandler(sock);

            // Send messages held while the socket was offline
            for (const e of offlineMessageBuffer) {
                handle.sock.send(e);
            }

            offlineMessageBuffer = [];

            await disconnectLock;
            killPingHandler = true;
            sock.close();
        } catch (e) {}

        console.log("[Websocket] Disconnected? Retry", retry);
        handle.emitter.emit("disconnect", {});

        await new Promise((resolve) => setTimeout(resolve, 1000));
        retry++;
    }

    // Here, the WS could not connect
    // Please refresh the page...
}

websocketLoop();

function sendMessage(message) {
    if (!handle.isConnected) {
        offlineMessageBuffer.push(message);
    } else {
        handle.sock.send(message);
    }
}

function subscribe(type, handler) {
    handle.emitter.on(type, handler);
}

function unsubscribe(type, handler) {
    handle.emitter.off(type, handler);
}

export {
    connectWebsocket,
    websocketIsConnected,
    sendMessage,
    subscribe,
    unsubscribe,
};
