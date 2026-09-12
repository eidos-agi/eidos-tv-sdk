import { z } from "zod";
import type { AuthorityMode, TvState } from "@eidos-tv/protocol";
import { applyFixture, SCENARIOS } from "./scenarios";
import {
  createInitialTvState,
  reduceRemoteEvent,
  launchApp,
  currentFocusLabel,
  setNetwork,
  HOME_CONTENT,
  APPS,
} from "./tv";
export const KEYS = [
  "POWER",
  "HOME",
  "BACK",
  "OPTIONS",
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "SELECT",
  "PLAY_PAUSE",
  "REWIND",
  "FAST_FORWARD",
  "VOLUME_UP",
  "VOLUME_DOWN",
  "MUTE",
] as const;
export const faultsSchema = z
  .object({
    stt: z.boolean(),
    drop: z.boolean(),
    duplicate: z.boolean(),
    disconnect: z.boolean(),
    crash: z.boolean(),
    purchase: z.boolean(),
    pin: z.boolean(),
    timeout: z.boolean(),
    packetLoss: z.boolean(),
  })
  .strict();
export type Faults = z.infer<typeof faultsSchema>;
export const NO_FAULTS: Faults = {
  stt: false,
  drop: false,
  duplicate: false,
  disconnect: false,
  crash: false,
  purchase: false,
  pin: false,
  timeout: false,
  packetLoss: false,
};
export const configSchema = z
  .object({
    scenarioId: z.string().refine((id) => SCENARIOS.some((s) => s.id === id)),
    authority: z.enum(["semantic", "remote-only", "visual-only", "human"]),
    seed: z.number().int().min(1).max(2147483647),
    faults: faultsSchema,
    latencyMs: z.number().int().min(0).max(30000),
    network: z.enum(["normal", "slow", "intermittent", "offline"]),
  })
  .strict();
export type SessionConfig = z.infer<typeof configSchema>;
const empty = z.object({}).strict();
const keySchema = z.object({ key: z.enum(KEYS) }).strict();
const sid = z.string().min(1).max(100);
export const TOOL_SCHEMAS = {
  "session.release": empty,
  "tv.observe": empty,
  "remote.observe": empty,
  "tv.getCapabilities": empty,
  "tv.getPlayback": empty,
  "remote.press": keySchema,
  "remote.keyDown": keySchema,
  "remote.keyUp": keySchema,
  "remote.type": z.object({ text: z.string().max(2000) }).strict(),
  "remote.pttStart": z.object({ sessionId: sid }).strict(),
  "remote.pttSpeak": z
    .object({
      sessionId: sid,
      text: z.string().max(2000),
      confidence: z.number().min(0).max(1),
      partials: z.array(z.string().max(2000)).max(20).optional(),
    })
    .strict(),
  "remote.pttStop": z.object({ sessionId: sid }).strict(),
  "remote.pttCancel": z.object({ sessionId: sid }).strict(),
  "remote.shortcut": z
    .object({
      appId: z.enum(["video", "youtube", "netflix", "disney", "prime"]),
    })
    .strict(),
  "session.wait": z.object({ ms: z.number().int().min(0).max(30000) }).strict(),
  "session.requestHelp": z
    .object({ reason: z.string().min(1).max(500) })
    .strict(),
  "tv.launchApp": z
    .object({
      appId: z.enum(["video", "youtube", "netflix", "disney", "prime"]),
    })
    .strict(),
  "tv.openContent": z
    .object({
      contentId: z
        .string()
        .refine((id) => HOME_CONTENT.some((c) => c.id === id)),
      episode: z.number().int().min(1).max(13).optional(),
    })
    .strict(),
} as const;
export type ToolName = keyof typeof TOOL_SCHEMAS;
export interface Actor {
  id: string;
  kind: "human" | "agent" | "system";
  transport: "ui" | "webmcp" | "mcp" | "internal";
}
export interface Entry {
  seq: number;
  timeMs: number;
  type: string;
  source: string;
  summary: string;
  payload?: unknown;
}
export interface RecordedAction {
  id: string;
  actor: Actor;
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  error?: string;
}
export interface TraceFile {
  version: 1;
  config: SessionConfig;
  actions: RecordedAction[];
  finalStateHash: string;
}
const reads = new Set([
  "tv.observe",
  "remote.observe",
  "tv.getCapabilities",
  "tv.getPlayback",
]);
export function toolNames(authority: AuthorityMode): ToolName[] {
  if (authority === "human" || authority === "visual-only") return [];
  return (Object.keys(TOOL_SCHEMAS) as ToolName[]).filter(
    (n) =>
      n !== "session.release" &&
      (authority === "semantic" ||
        !["tv.launchApp", "tv.openContent"].includes(n)),
  );
}
export function stateHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (const c of text) {
    hash ^= c.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export class Session {
  readonly config: SessionConfig;
  private tv: TvState;
  readonly trace: Entry[] = [];
  readonly actions: RecordedAction[] = [];
  private clock = 0;
  private held = new Set<string>();
  private seen = new Map<
    string,
    { signature: string; value: unknown; error?: string }
  >();
  private used = new Set<string>();
  private ptt?: {
    id: string;
    start: number;
    due?: number;
    text?: string;
    confidence?: number;
    owner: string;
  };
  private random: number;
  private deferredPlayback?: number;
  private helpReason?: string;
  constructor(config: Partial<SessionConfig> = {}) {
    this.config = configSchema.parse({
      scenarioId: "play-bluey",
      authority: "remote-only",
      seed: 42,
      faults: NO_FAULTS,
      latencyMs: 0,
      network: "normal",
      ...config,
    });
    this.tv = applyFixture(createInitialTvState(), this.config.scenarioId);
    this.tv.network =
      this.config.scenarioId === "network" ? "slow" : this.config.network;
    const scenario = SCENARIOS.find((s) => s.id === this.config.scenarioId)!;
    if ("fault" in scenario) this.config.faults[scenario.fault] = true;
    this.random = this.config.seed;
    this.log("session.created", "system", this.config.scenarioId);
  }
  private log(
    type: string,
    source: string,
    summary: string,
    payload?: unknown,
  ) {
    this.trace.push({
      seq: this.trace.length,
      timeMs: this.clock,
      type,
      source,
      summary,
      payload,
    });
  }
  observe() {
    return structuredClone({
      tv: this.tv,
      focusLabel: currentFocusLabel(this.tv),
      timeMs: this.clock,
    });
  }
  snapshot() {
    return structuredClone(this.tv);
  }
  get needsRelease() {
    return !!this.ptt || this.held.size > 0;
  }
  get timeMs() {
    return this.clock;
  }
  get help() {
    return this.helpReason;
  }
  export(): TraceFile {
    return structuredClone({
      version: 1,
      config: this.config,
      actions: this.actions,
      finalStateHash: stateHash(this.tv),
    });
  }
  private one(name: string) {
    if (this.used.has(name)) return false;
    this.used.add(name);
    return true;
  }
  private rand() {
    this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0;
    return this.random / 4294967296;
  }
  private transition(
    result: ReturnType<typeof reduceRemoteEvent>,
    source: string,
  ) {
    this.tv = result.state;
    for (const e of result.events)
      this.log(e.type, source, e.summary, e.payload);
  }
  private faults(source: string) {
    if (
      !this.tv.playback.contentId ||
      this.tv.playback.state === "idle" ||
      this.tv.playback.state === "paused"
    )
      return;
    if (this.config.faults.purchase) {
      this.tv.modal = "purchase";
      this.tv.playback.state = "paused";
      this.log("fault.injected", source, "purchase");
      return;
    }
    if (this.config.faults.pin) {
      this.tv.modal = "parental-pin";
      this.tv.playback.state = "paused";
      this.log("fault.injected", source, "parental PIN");
      return;
    }
    if (this.config.faults.crash && this.one("crash")) {
      this.tv.route = "home";
      this.tv.playback.state = "idle";
      this.log("fault.injected", source, "app crash");
      return;
    }
    if (this.tv.playback.state === "buffering" && this.tv.network !== "offline")
      this.deferredPlayback ??=
        this.clock +
        (this.tv.network === "slow"
          ? 1500
          : 500 + Math.floor(this.rand() * 1000));
  }
  private deliver(source: string) {
    if (this.ptt?.due !== undefined && this.clock >= this.ptt.due) {
      const p = this.ptt;
      this.ptt.due = undefined;
      if (this.config.faults.timeout || this.config.faults.packetLoss) {
        this.log(
          "voice.unresolved",
          source,
          this.config.faults.timeout ? "STT timeout" : "audio packet loss",
        );
        return;
      }
      this.transition(
        reduceRemoteEvent(this.tv, {
          type: "ptt.transcript",
          sessionId: p.id,
          text: p.text ?? "",
          confidence: this.config.faults.stt
            ? Math.min(p.confidence ?? 0, 0.43)
            : (p.confidence ?? 0),
        }),
        source,
      );
      this.faults(source);
    }
    if (
      this.deferredPlayback !== undefined &&
      this.clock >= this.deferredPlayback
    ) {
      this.deferredPlayback = undefined;
      if (
        this.tv.network !== "offline" &&
        this.tv.playback.state === "buffering"
      ) {
        this.tv.playback.state = "playing";
        this.log("playback.recovered", source, "network buffer filled");
      }
    }
  }
  dispatch(
    actor: Actor,
    name: string,
    input: Record<string, unknown> = {},
    id: string = `action-${this.actions.length}`,
  ): unknown {
    const signature = JSON.stringify([actor, name, input]);
    const old = this.seen.get(id);
    if (old) {
      if (old.signature !== signature) throw Error("ID_REUSED");
      if (old.error) throw Error(old.error);
      return structuredClone(old.value);
    }
    if (this.actions.length >= 1000) throw Error("ACTION_LIMIT");
    const record: RecordedAction = {
      id,
      actor: structuredClone(actor),
      name,
      input: structuredClone(input),
      ok: false,
    };
    this.actions.push(record);
    this.log("action.requested", actor.id, name, { id, input });
    try {
      const allowed =
        actor.kind === "system" &&
        actor.transport === "internal" &&
        name === "session.release"
          ? true
          : (actor.kind === "human" ||
                this.config.authority === "visual-only") &&
              actor.transport === "ui"
            ? name.startsWith("remote.") ||
              name === "session.wait" ||
              name === "session.requestHelp"
            : toolNames(this.config.authority).includes(name as ToolName);
      if (!allowed) throw Error("AUTHORITY_DENIED");
      const schema = TOOL_SCHEMAS[name as ToolName];
      if (!schema) throw Error("UNKNOWN_TOOL");
      const p = schema.parse(input) as Record<string, any>;
      if (!reads.has(name)) this.clock += 1;
      this.log("action.allowed", actor.id, name);
      let value: unknown;
      if (name === "tv.observe") value = this.observe();
      else if (name === "tv.getPlayback")
        value = structuredClone(this.tv.playback);
      else if (name === "tv.getCapabilities")
        value = {
          id: "tv-1",
          pack: "generic-streaming-tv",
          apps: APPS.map((a) => ({ id: a.id, title: a.title })),
          tools: toolNames(this.config.authority),
        };
      else if (name === "remote.observe")
        value = {
          id: "remote-1",
          controls: "tv-1",
          connected: !this.config.faults.disconnect,
          held: [...this.held],
          pttActive: !!this.ptt,
          keys: KEYS,
        };
      else {
        if (
          name.startsWith("remote.") &&
          this.config.faults.disconnect &&
          !["remote.pttCancel", "remote.keyUp"].includes(name)
        )
          throw Error("REMOTE_DISCONNECTED");
        if (name === "session.release") {
          this.ptt = undefined;
          this.held.clear();
          this.tv.voice = {
            ...this.tv.voice,
            active: false,
            sessionId: undefined,
          };
          this.log("control.released", actor.id, "Pending input cancelled");
        } else if (name === "session.wait") {
          this.clock += p.ms;
          this.deliver(actor.id);
        } else if (name === "session.requestHelp") {
          this.helpReason = p.reason;
          this.log("human.requested", actor.id, p.reason);
        } else if (name === "remote.pttStart") {
          if (this.ptt) throw Error("PTT_ALREADY_ACTIVE");
          if (this.tv.power === "off") throw Error("TV_OFF");
          this.ptt = { id: p.sessionId, start: this.clock, owner: actor.id };
          this.transition(
            reduceRemoteEvent(this.tv, {
              type: "ptt",
              phase: "start",
              sessionId: p.sessionId,
            }),
            actor.id,
          );
        } else if (name.startsWith("remote.ptt")) {
          if (
            !this.ptt ||
            this.ptt.id !== p.sessionId ||
            this.ptt.owner !== actor.id
          )
            throw Error("PTT_SESSION_MISMATCH");
          if (name === "remote.pttSpeak") {
            if (this.ptt.text !== undefined)
              throw Error("PTT_ALREADY_SUBMITTED");
            for (const partial of p.partials ?? [])
              this.log("stt.partial", actor.id, partial);
            Object.assign(this.ptt, {
              text: p.text,
              confidence: p.confidence,
              due: this.clock + this.config.latencyMs,
            });
            this.deliver(actor.id);
          } else {
            if (this.ptt.due !== undefined || this.ptt.text === undefined)
              this.log(
                "ptt.cancelled",
                actor.id,
                name === "remote.pttCancel"
                  ? "cancelled"
                  : "released before speech completed",
              );
            this.ptt = undefined;
            this.transition(
              reduceRemoteEvent(this.tv, {
                type: "ptt",
                phase: "stop",
                sessionId: p.sessionId,
              }),
              actor.id,
            );
          }
        } else if (name === "remote.type")
          this.transition(
            reduceRemoteEvent(this.tv, { type: "text", text: p.text }),
            actor.id,
          );
        else if (name === "remote.shortcut" || name === "tv.launchApp") {
          if (name === "remote.shortcut")
            this.log("remote.shortcut", actor.id, p.appId);
          this.transition(launchApp(this.tv, p.appId), actor.id);
        } else if (name === "tv.openContent") {
          this.transition(
            reduceRemoteEvent(this.tv, {
              type: "ptt.transcript",
              sessionId: "semantic",
              text: `play ${HOME_CONTENT.find((c) => c.id === p.contentId)!.title} episode ${p.episode ?? 1}`,
              confidence: 1,
            }),
            actor.id,
          );
          this.faults(actor.id);
        } else {
          if (name === "remote.keyUp") {
            if (!this.held.delete(p.key)) throw Error("KEY_NOT_HELD");
            this.log("remote.up", actor.id, p.key);
          } else {
            if (name === "remote.keyDown") {
              if (this.held.has(p.key)) throw Error("KEY_ALREADY_HELD");
              this.held.add(p.key);
              this.log("remote.down", actor.id, p.key);
            }
            if (this.config.faults.drop && this.one("drop"))
              this.log("fault.injected", actor.id, `dropped ${p.key}`);
            else {
              const count =
                this.config.faults.duplicate && this.one("duplicate") ? 2 : 1;
              if (count === 2)
                this.log("fault.injected", actor.id, `duplicate ${p.key}`);
              for (let i = 0; i < count; i++)
                this.transition(
                  reduceRemoteEvent(this.tv, {
                    type: "key",
                    key: p.key,
                    phase: "press",
                  }),
                  actor.id,
                );
              if (p.key === "POWER" && this.tv.power === "off") {
                this.ptt = undefined;
                this.held.clear();
                this.deferredPlayback = undefined;
              }
              this.faults(actor.id);
            }
          }
        }
        value = {
          accepted: true,
          sequence: this.trace.length,
          timeMs: this.clock,
        };
      }
      record.ok = true;
      this.seen.set(id, { signature, value: structuredClone(value) });
      return value;
    } catch (e) {
      const error =
        e instanceof z.ZodError
          ? "INVALID_INPUT"
          : e instanceof Error
            ? e.message
            : String(e);
      record.error = error;
      this.log("action.denied", actor.id, error, { name });
      this.seen.set(id, { signature, value: null, error });
      throw Error(error);
    }
  }
}
export function replay(file: TraceFile, through = file.actions.length) {
  if (
    file.version !== 1 ||
    !Array.isArray(file.actions) ||
    file.actions.length > 1000
  )
    throw Error("INVALID_TRACE");
  const session = new Session(configSchema.parse(file.config));
  for (const a of file.actions.slice(0, through)) {
    let error: string | undefined;
    try {
      session.dispatch(a.actor, a.name, a.input, a.id);
    } catch (e) {
      error = (e as Error).message;
    }
    if ((error === undefined) !== a.ok || error !== a.error)
      throw Error(`REPLAY_DIVERGED at ${a.id}`);
  }
  if (
    through === file.actions.length &&
    stateHash(session.snapshot()) !== file.finalStateHash
  )
    throw Error("REPLAY_HASH_MISMATCH");
  return session;
}
