import {
  BackendTransportAgent,
  type BackendTransportAgentOptions,
} from "./backendTransportAgent";
import {
  WebSocketBackendTransport,
  type WebSocketBackendTransportOptions,
} from "./webSocketBackendTransport";

export {
  SOCKET_DEBUG_EVENT_NAME,
  WebSocketBackendTransport,
} from "./webSocketBackendTransport";
export type {
  SocketDebugEvent,
  WebSocketBackendTransportOptions,
} from "./webSocketBackendTransport";

export type SocketAdapterAgentOptions = BackendTransportAgentOptions & {
  transport?: WebSocketBackendTransportOptions;
};

/** Socket-specific composition over the shared BackendTransportAgent. */
export class SocketAdapterAgent extends BackendTransportAgent {
  constructor(url: string, options: SocketAdapterAgentOptions = {}) {
    const { transport, ...agentOptions } = options;
    super(new WebSocketBackendTransport(url, transport), {
      ...agentOptions,
      description:
        agentOptions.description ?? "Socket-backed AG-UI adapter agent.",
    });
  }
}
