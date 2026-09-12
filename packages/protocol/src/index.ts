export type AuthorityMode =
  "semantic" | "remote-only" | "visual-only" | "human";

export type RemoteKey =
  | "POWER"
  | "HOME"
  | "BACK"
  | "OPTIONS"
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "SELECT"
  | "PLAY_PAUSE"
  | "REWIND"
  | "FAST_FORWARD"
  | "VOLUME_UP"
  | "VOLUME_DOWN"
  | "MUTE";

export type RemoteEvent =
  | { type: "key"; key: RemoteKey; phase: "press" | "down" | "up" }
  | { type: "text"; text: string }
  | { type: "ptt"; phase: "start" | "stop"; sessionId: string }
  | {
      type: "ptt.transcript";
      sessionId: string;
      text: string;
      confidence: number;
    };

export interface ActionEnvelope<T = unknown> {
  id: string;
  sessionId: string;
  source: {
    kind: "human" | "agent" | "fixture" | "replay" | "system";
    id: string;
    transport: "ui" | "webmcp" | "mcp" | "rest" | "replay" | "internal";
  };
  targetDeviceId: string;
  action: string;
  payload: T;
  timestamp: string;
}

export interface TraceEvent {
  id: string;
  at: string;
  type: string;
  source: string;
  summary: string;
  payload?: unknown;
}

export interface PlaybackState {
  state: "idle" | "playing" | "paused" | "buffering";
  contentId?: string;
  title?: string;
  episode?: string;
  position?: number;
}

export interface TvState {
  power: "on" | "off";
  route:
    | "home"
    | "movies"
    | "shows"
    | "live"
    | "music"
    | "apps"
    | "settings"
    | "search"
    | "details"
    | "playback";
  focusIndex: number;
  activeAppId?: string;
  selectedContentId?: string;
  playback: PlaybackState;
  modal?: "profile" | "purchase" | "parental-pin";
  network: "normal" | "slow" | "intermittent" | "offline";
  volume: number;
  muted: boolean;
  voice?: {
    active: boolean;
    sessionId?: string;
    transcript?: string;
    confidence?: number;
  };
  query?: string;
  signedIn?: boolean;
  profile?: string;
}

export interface RunMetrics {
  success: boolean;
  actions: number;
  remotePresses: number;
  pttInteractions: number;
  recoveries: number;
  policyViolations: number;
  startedAt: number;
}
