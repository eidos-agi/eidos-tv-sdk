import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  Session,
  SCENARIOS,
  toolNames,
  TOOL_SCHEMAS,
  replay,
  configSchema,
  type SessionConfig,
  type Actor,
  type TraceFile,
} from "@eidos-tv/core";
import { evaluate } from "./evaluator";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export class Broker {
  readonly sessions = new Map<string, Session>();
  private grants = new Map<
    string,
    { sessionId: string; actorId: string; expires: number }
  >();
  private leases = new Map<string, string>();
  private revisions = new Map<string, number>();
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  create(config: Partial<SessionConfig> = {}) {
    if (this.sessions.size >= 30) throw Error("SESSION_LIMIT");
    const id = randomUUID();
    this.sessions.set(id, new Session(config));
    this.revisions.set(id, 1);
    this.save(id);
    return id;
  }
  session(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw Error("SESSION_NOT_FOUND");
    return s;
  }
  projection(id: string) {
    const s = this.session(id);
    return {
      id,
      revision: this.revisions.get(id) ?? 1,
      config: s.config,
      observation: s.observe(),
      trace: s.trace,
      result: evaluate(s),
      scenario: SCENARIOS.find((v) => v.id === s.config.scenarioId),
      lease: this.leases.has(id),
      tools: toolNames(s.config.authority),
    };
  }
  publicProjection(id: string) {
    const s = this.session(id);
    return {
      id,
      observation: s.observe(),
      scenario: SCENARIOS.find((v) => v.id === s.config.scenarioId),
      authority: s.config.authority,
      tools: toolNames(s.config.authority),
    };
  }
  grant(id: string, revision?: number) {
    this.session(id);
    if (revision !== undefined && revision !== (this.revisions.get(id) ?? 1))
      throw Error("STALE_SESSION");
    this.revoke(id);
    const token = randomBytes(32).toString("base64url");
    const actorId = randomUUID();
    this.grants.set(digest(token), {
      sessionId: id,
      actorId,
      expires: Date.now() + 3600000,
    });
    this.leases.set(id, actorId);
    return { token, sessionId: id, expiresIn: 3600 };
  }
  revokeToken(token: string) {
    const g = this.grants.get(digest(token));
    if (g && this.leases.get(g.sessionId) === g.actorId)
      this.revoke(g.sessionId);
    else this.grants.delete(digest(token));
  }
  authenticate(token: string) {
    const g = this.grants.get(digest(token));
    if (!g || g.expires < Date.now()) throw Error("INVALID_GRANT");
    this.session(g.sessionId);
    return g;
  }
  revoke(id: string) {
    const s = this.sessions.get(id);
    if (s?.needsRelease) {
      s.dispatch(
        { id: "operator", kind: "system", transport: "internal" },
        "session.release",
        {},
        randomUUID(),
      );
      this.save(id);
    }
    for (const [key, g] of this.grants)
      if (g.sessionId === id) this.grants.delete(key);
    this.leases.delete(id);
  }
  reset(id: string, config: SessionConfig) {
    this.session(id);
    this.revoke(id);
    writeFileSync(
      join(this.directory, `${randomUUID()}.json`),
      JSON.stringify(this.session(id).export()),
      { mode: 0o600 },
    );
    this.sessions.set(id, new Session(configSchema.parse(config)));
    this.revisions.set(id, (this.revisions.get(id) ?? 1) + 1);
    this.save(id);
  }
  call(
    id: string,
    actor: Actor,
    name: string,
    input: Record<string, unknown>,
    requestId: string,
    revision?: number,
  ) {
    if (revision !== undefined && revision !== (this.revisions.get(id) ?? 1))
      throw Error("STALE_SESSION");
    const lease = this.leases.get(id);
    if (lease && lease !== actor.id) throw Error("LEASE_HELD");
    try {
      return this.session(id).dispatch(actor, name, input, requestId);
    } finally {
      this.save(id);
    }
  }
  agentCall(
    token: string,
    name: string,
    input: Record<string, unknown>,
    requestId: string,
    transport: Actor["transport"] = "mcp",
  ) {
    const g = this.authenticate(token);
    return this.call(
      g.sessionId,
      {
        id: g.actorId,
        kind:
          this.session(g.sessionId).config.authority === "human" &&
          transport === "ui"
            ? "human"
            : "agent",
        transport,
      },
      name,
      input,
      requestId,
    );
  }
  tools(id: string) {
    return toolNames(this.session(id).config.authority).map((name) => ({
      name,
      description: name.startsWith("remote.")
        ? `Operate the session's virtual remote: ${name}.`
        : `${name} in this session.`,
      inputSchema: z.toJSONSchema(TOOL_SCHEMAS[name]),
      annotations: {
        readOnlyHint: /observe|get/.test(name),
        destructiveHint: false,
        idempotentHint: /observe|get/.test(name),
      },
    }));
  }
  save(id: string) {
    const file = join(this.directory, `${id}.json`);
    writeFileSync(file + ".tmp", JSON.stringify(this.session(id).export()), {
      mode: 0o600,
    });
    renameSync(file + ".tmp", file);
  }
  runs() {
    return readdirSync(this.directory)
      .filter((p) => /^[\da-f-]+\.json$/.test(p))
      .map((p) => ({ id: p.slice(0, -5) }));
  }
  readRun(id: string): TraceFile {
    if (!/^[\da-f-]{36}$/.test(id)) throw Error("INVALID_RUN");
    return JSON.parse(readFileSync(join(this.directory, `${id}.json`), "utf8"));
  }
  restore(id: string) {
    this.revoke(id);
    const file = this.readRun(id);
    const s = replay(file);
    this.sessions.set(id, s);
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    return this.projection(id);
  }
}
