/** Framework-independent SDK boundary. Configuration belongs to the host. */
export interface PendoConfig {
  publicAppId: string;
  enabled?: boolean;
  visitorId?: string;
  accountId?: string;
  environment?: string;
}

export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, unknown>;
}

export type Track = (event: AnalyticsEvent) => void;

/** Pendo conversation properties; IDs and message completion belong to the host. */
export interface AgentMessageProperties {
  agentId: string;
  conversationId: string;
  messageId: string;
  content: string;
  suggestedPrompt?: boolean;
  toolsUsed?: string[];
  agentModelsUsed?: string[];
  agentFilesUploaded?: { type: string; name: string }[];
  agentSubagentsUsed?: string[];
}

export interface AgentReactionProperties extends Omit<AgentMessageProperties, "content"> {
  content: "positive" | "negative" | "unreact";
  agentUserReactionComments?: string[];
}

export type TrackAgent = (...args:
  | [eventType: "prompt" | "agent_response", agenticProperties: AgentMessageProperties, properties?: Record<string, unknown>]
  | [eventType: "user_reaction", agenticProperties: AgentReactionProperties, properties?: Record<string, unknown>]
) => void;

/** Snapshot conversation data before the official startup queue receives it. */
function snapshotAgentArgs(args: Parameters<TrackAgent>): Parameters<TrackAgent> {
  const copyMessage = <T extends AgentMessageProperties>(message: T): T => ({
    ...message,
    ...(message.toolsUsed && { toolsUsed: [...message.toolsUsed] }),
    ...(message.agentModelsUsed && { agentModelsUsed: [...message.agentModelsUsed] }),
    ...(message.agentSubagentsUsed && { agentSubagentsUsed: [...message.agentSubagentsUsed] }),
    ...(message.agentFilesUploaded && { agentFilesUploaded: message.agentFilesUploaded.map((file) => ({ ...file })) }),
  });
  const properties = args[2] && { ...args[2] };
  if (args[0] === "user_reaction") {
    const message = copyMessage(args[1]);
    if (message.agentUserReactionComments) message.agentUserReactionComments = [...message.agentUserReactionComments];
    return [args[0], message, properties];
  }
  return [args[0], copyMessage(args[1]), properties];
}

/** The official snippet installs this object on the browser window. */
export interface PendoSdk {
  _q?: unknown[][];
  initialize?(options: Record<string, unknown>): void;
  identify?(options: Record<string, unknown>): void;
  updateOptions?(options: Record<string, unknown>): void;
  pageLoad?(): void;
  track?(name: string, properties: Record<string, unknown>): void;
  trackAgent?(eventType: Parameters<TrackAgent>[0], agenticProperties: AgentMessageProperties | AgentReactionProperties, properties: Record<string, unknown>): void;
  flushNow?(options?: { hidden?: boolean; unload?: boolean }): void;
}

export function getPendo(): PendoSdk | undefined {
  return typeof window === "undefined" ? undefined : (window as Window & { pendo?: PendoSdk }).pendo;
}

type AnalyticsWindow = Window & { __appPendoConfig?: { enabled: boolean; environment?: string } };

function trackingConfig() {
  return typeof window === "undefined" ? undefined : (window as AnalyticsWindow).__appPendoConfig;
}

export function isPendoEnabled() { return trackingConfig()?.enabled === true; }

const properties = (value?: Record<string, unknown>) => {
  const environment = trackingConfig()?.environment;
  return { ...value, ...(environment ? { environment } : {}) };
};

/** Direct window.pendo calls; the official snippet owns startup queueing. */
export const track: Track = (event) => {
  if (!isPendoEnabled()) return;
  try { getPendo()?.track?.(event.name, properties(event.properties)); } catch { /* Analytics must not affect the UI. */ }
};

export const trackAgent: TrackAgent = (...args) => {
  if (!isPendoEnabled()) return;
  try {
    const sdk = getPendo();
    if (!sdk?.trackAgent) return;
    const [type, message, extra] = snapshotAgentArgs(args);
    sdk.trackAgent(type, message, properties(extra));
  } catch { /* Do not fall back to ordinary track. */ }
};

export function flushNow(options?: { hidden?: boolean; unload?: boolean }) {
  if (!isPendoEnabled()) return;
  try { getPendo()?.flushNow?.(options); } catch { /* Best-effort delivery. */ }
}
