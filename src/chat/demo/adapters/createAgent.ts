import { BackendTransportAgent } from "./backendTransportAgent";
import {
  SocketAdapterAgent,
  type SocketAdapterAgentOptions,
} from "./socketAdapter";
import {
  SseAdapterAgent,
  type SseAdapterAgentOptions,
} from "./sseAdapter";

export type WebSocketAgentConfig = {
  transport: "websocket";
  url: string;
  options?: SocketAdapterAgentOptions;
};

export type SseAgentConfig = {
  transport: "sse";
  url: string;
  options?: SseAdapterAgentOptions;
};

export type CreateAgentConfig = WebSocketAgentConfig | SseAgentConfig;

export function createAgent(config: WebSocketAgentConfig): SocketAdapterAgent;
export function createAgent(config: SseAgentConfig): SseAdapterAgent;
export function createAgent(config: CreateAgentConfig): BackendTransportAgent;
export function createAgent(config: CreateAgentConfig): BackendTransportAgent {
  switch (config.transport) {
    case "websocket":
      return new SocketAdapterAgent(config.url, config.options);
    case "sse":
      return new SseAdapterAgent(config.url, config.options);
    default:
      throw new Error(`Unsupported backend transport: ${String(config)}`);
  }
}
