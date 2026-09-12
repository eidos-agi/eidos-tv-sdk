import type { RemoteEvent, TvState } from "@eidos-tv/protocol";
import type { TransitionResult } from "./tv";

export const APPLICATIONS = [
  {
    id: "media",
    name: "Streaming TV",
    description: "Media navigation, playback, and account gates.",
    faults: [
      "stt",
      "drop",
      "duplicate",
      "disconnect",
      "crash",
      "purchase",
      "pin",
      "timeout",
      "packetLoss",
    ],
  },
  {
    id: "life-center",
    name: "Life Center (example)",
    description: "Personal AI requests and simulated delegated jobs.",
    faults: [
      "stt",
      "drop",
      "duplicate",
      "disconnect",
      "crash",
      "timeout",
      "packetLoss",
    ],
  },
] as const;
export function applicationId(scenarioId: string) {
  return scenarioId.startsWith("life-") ? "life-center" : "media";
}
export const LIFE_PROMPTS = [
  "What needs my attention?",
  "Prepare my next trip",
  "Help me plan tomorrow",
];
export function initialLife(): NonNullable<TvState["life"]> {
  return { draft: "", nextId: 1, jobs: [] };
}
const event = (type: string, summary: string) => ({ type, summary });
export function submitLife(state: TvState, text: string): TransitionResult {
  const next = structuredClone(state);
  if (!next.life) throw Error("APPLICATION_TOOL_UNAVAILABLE");
  if (next.power === "off" || next.modal || !next.signedIn)
    throw Error("TV_UNAVAILABLE");
  if (!text.trim()) throw Error("EMPTY_REQUEST");
  if (next.life.jobs.length >= 100) throw Error("JOB_LIMIT");
  const id = `job-${next.life.nextId++}`;
  next.life.jobs.unshift({
    id,
    text: text.trim(),
    status: "queued",
    elapsedMs: 0,
  });
  next.life.selected = id;
  next.life.draft = "";
  next.focusIndex = 0;
  return {
    state: next,
    events: [event("job.queued", `${id}: ${text.trim()}`)],
  };
}
export function reduceLife(
  state: TvState,
  input: RemoteEvent,
): TransitionResult | undefined {
  if (!state.life || input.type === "ptt") return;
  if (state.power === "off" || state.modal || !state.signedIn) return;
  const next = structuredClone(state);
  const life = next.life!;
  if (input.type === "ptt.transcript") {
    next.voice = {
      ...next.voice,
      active: !!next.voice?.active,
      transcript: input.text,
      confidence: input.confidence,
    };
    if (input.confidence < 0.65 || !input.text.trim())
      return {
        state: next,
        events: [
          event("stt.final", input.text),
          event("voice.unresolved", "Please repeat the instruction"),
        ],
      };
    const result = submitLife(next, input.text);
    result.events.unshift(event("stt.final", input.text));
    return result;
  }
  if (input.type === "text") {
    life.draft = input.text;
    life.selected = undefined;
    next.focusIndex = 0;
    return { state: next, events: [event("remote.text", input.text)] };
  }
  if (
    input.phase !== "press" ||
    ["POWER", "VOLUME_UP", "VOLUME_DOWN", "MUTE"].includes(input.key)
  )
    return;
  const events = [event("remote.key", input.key)];
  if (["BACK", "HOME"].includes(input.key)) {
    life.selected = undefined;
    life.draft = "";
    next.focusIndex = 0;
  } else if (input.key === "OPTIONS" && life.selected) {
    const job = life.jobs.find((j) => j.id === life.selected);
    if (job && !["completed", "cancelled"].includes(job.status)) {
      job.status = "cancelled";
      events.push(event("job.cancelled", job.id));
    }
  } else if (!life.selected) {
    if (["LEFT", "UP", "RIGHT", "DOWN"].includes(input.key))
      next.focusIndex = Math.max(
        0,
        Math.min(
          2 + life.jobs.length,
          next.focusIndex + (["LEFT", "UP"].includes(input.key) ? -1 : 1),
        ),
      );
    if (input.key === "SELECT") {
      if (life.draft || next.focusIndex < 3) {
        const result = submitLife(
          next,
          life.draft || LIFE_PROMPTS[next.focusIndex],
        );
        result.events.unshift(...events);
        return result;
      }
      life.selected = life.jobs[next.focusIndex - 3]?.id;
    }
  }
  return { state: next, events };
}
export function advanceLife(
  state: TvState,
  ms: number,
  crash: boolean,
): TransitionResult {
  const next = structuredClone(state);
  const events: TransitionResult["events"] = [];
  for (const job of next.life?.jobs ?? []) {
    if (["completed", "cancelled"].includes(job.status)) continue;
    const previous = job.status;
    if (next.network === "offline" || crash) {
      job.status = "blocked";
      if (previous !== "blocked")
        events.push(
          event(
            "job.blocked",
            crash ? "Simulated worker crash" : "Network offline",
          ),
        );
      continue;
    }
    job.elapsedMs += ms;
    job.status =
      job.elapsedMs >= (next.network === "normal" ? 4500 : 9000)
        ? "completed"
        : job.elapsedMs >= 1500
          ? "working"
          : "queued";
    if (job.status === "completed")
      job.result = /trip|travel/i.test(job.text)
        ? "Sample travel checklist: confirm dates, compare lodging, and prepare documents. No bookings were made."
        : /tomorrow|plan/i.test(job.text)
          ? "Sample plan: a focused morning, grouped errands, and an evening buffer. No calendar entries were created."
          : /attention|brief/i.test(job.text)
            ? "Sample briefing: review tomorrow’s schedule, your packing list, and your top priority. No personal accounts are connected."
            : "The simulated worker received your instruction. A real agent is required to perform this specific job. No external work was performed.";
    if (previous !== job.status)
      events.push(event(`job.${job.status}`, job.id));
  }
  return { state: next, events };
}
