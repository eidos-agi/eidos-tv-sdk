import type { RemoteEvent, RemoteKey, TvState } from "@eidos-tv/protocol";
import { reduceLife, LIFE_PROMPTS } from "./applications";
export interface ContentCard {
  id: string;
  title: string;
  subtitle: string;
  kind: "show" | "movie" | "app";
  accent: string;
}
export const HOME_CONTENT: ContentCard[] = [
  {
    id: "bluey",
    title: "Bluey",
    subtitle: "S1 · 13 episodes",
    kind: "show",
    accent: "#44a7ff",
  },
  {
    id: "wild-robot",
    title: "The Wild Robot",
    subtitle: "Movie",
    kind: "movie",
    accent: "#d59154",
  },
  {
    id: "inside-out-2",
    title: "Inside Out 2",
    subtitle: "Movie",
    kind: "movie",
    accent: "#9a67ff",
  },
  {
    id: "fallout",
    title: "Fallout",
    subtitle: "Season 1",
    kind: "show",
    accent: "#9a7a56",
  },
  {
    id: "mandalorian",
    title: "The Mandalorian",
    subtitle: "Season 3",
    kind: "show",
    accent: "#526473",
  },
];
export const APPS: ContentCard[] = [
  {
    id: "video",
    title: "Eidos Video",
    subtitle: "Streaming",
    kind: "app",
    accent: "#ff4f66",
  },
  {
    id: "youtube",
    title: "YouTube",
    subtitle: "Video",
    kind: "app",
    accent: "#ff3b30",
  },
  {
    id: "netflix",
    title: "Netflix",
    subtitle: "Streaming",
    kind: "app",
    accent: "#e50914",
  },
  {
    id: "disney",
    title: "Disney+",
    subtitle: "Streaming",
    kind: "app",
    accent: "#113ccf",
  },
  {
    id: "prime",
    title: "Prime Video",
    subtitle: "Streaming",
    kind: "app",
    accent: "#2d9cdb",
  },
];
export const INITIAL_TV_STATE: TvState = {
  power: "on",
  route: "home",
  focusIndex: 0,
  playback: { state: "idle" },
  network: "normal",
  volume: 35,
  muted: false,
  voice: { active: false },
  signedIn: true,
  profile: "Daniel",
};
export function createInitialTvState(): TvState {
  return structuredClone(INITIAL_TV_STATE);
}
export interface TransitionResult {
  state: TvState;
  events: Array<{ type: string; summary: string; payload?: unknown }>;
}
const event = (type: string, summary: string, payload?: unknown) => ({
  type,
  summary,
  payload,
});
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
export function searchResults(state: TvState) {
  return HOME_CONTENT.filter((c) =>
    c.title.toLowerCase().includes((state.query ?? "").toLowerCase()),
  );
}
function open(state: TvState, id: string) {
  const card = HOME_CONTENT.find((c) => c.id === id);
  if (!card) return;
  state.activeAppId = "video";
  state.selectedContentId = id;
  state.route = "details";
  state.focusIndex = 0;
  state.playback = {
    state: "idle",
    contentId: id,
    title: card.title,
    episode: id === "bluey" ? "Episode 1" : undefined,
    position: 0,
  };
}
export function startPlayback(state: TvState) {
  state.route = "playback";
  state.playback.state = state.network === "normal" ? "playing" : "buffering";
}
export function reduceRemoteEvent(
  state: TvState,
  input: RemoteEvent,
): TransitionResult {
  const applicationResult = reduceLife(state, input);
  if (applicationResult) return applicationResult;
  const next = structuredClone(state);
  const events: TransitionResult["events"] = [];
  if (input.type === "ptt") {
    next.voice = {
      ...next.voice,
      active: input.phase === "start",
      sessionId: input.phase === "start" ? input.sessionId : undefined,
    };
    events.push(
      event(
        `ptt.${input.phase === "start" ? "started" : "stopped"}`,
        input.sessionId,
      ),
    );
    return { state: next, events };
  }
  if (input.type === "ptt.transcript")
    return applyVoiceTranscript(state, input.text, input.confidence);
  if (input.type === "text") {
    if (next.power === "off" || next.modal || !next.signedIn)
      return {
        state: next,
        events: [
          event("action.blocked", "TV is unavailable or requires a person"),
        ],
      };
    next.query = input.text;
    next.route = "search";
    next.focusIndex = 0;
    return { state: next, events: [event("remote.text", input.text)] };
  }
  if (input.phase !== "press")
    return { state: next, events: [event(`remote.${input.phase}`, input.key)] };
  const key = input.key;
  events.push(event("remote.key", key));
  if (key === "POWER") {
    next.power = next.power === "on" ? "off" : "on";
    next.voice = { active: false };
    if (next.power === "off" && next.playback.contentId)
      next.playback.state = "paused";
    return { state: next, events };
  }
  if (next.power === "off")
    return {
      state: next,
      events: [...events, event("action.ignored", "TV is off")],
    };
  if (key === "VOLUME_UP" || key === "VOLUME_DOWN") {
    next.volume = clamp(next.volume + (key === "VOLUME_UP" ? 5 : -5), 0, 100);
    next.muted = false;
    return { state: next, events };
  }
  if (key === "MUTE") {
    next.muted = !next.muted;
    return { state: next, events };
  }
  // Modal handling precedes every navigation/playback route. No voice or semantic bypass.
  if (next.modal) {
    if (key === "BACK" || key === "HOME") {
      next.modal = undefined;
      next.route = "home";
      next.playback.state = "idle";
      events.push(
        event("policy.cancelled", "Returned without purchase or PIN entry"),
      );
    } else if (next.modal === "profile") {
      if (key === "RIGHT" || key === "LEFT")
        next.focusIndex = next.focusIndex === 0 ? 1 : 0;
      if (key === "SELECT") {
        next.profile = next.focusIndex === 0 ? "Daniel" : "Kids";
        next.modal = undefined;
        next.focusIndex = 0;
      }
    } else events.push(event("policy.blocked", "Human confirmation required"));
    return { state: next, events };
  }
  if (key === "HOME") {
    next.route = "home";
    next.focusIndex = 0;
    if (next.playback.contentId) next.playback.state = "paused";
    return { state: next, events };
  }
  if (key === "BACK") {
    next.route = next.route === "playback" ? "details" : "home";
    next.focusIndex = 0;
    if (next.playback.contentId) next.playback.state = "paused";
    return { state: next, events };
  }
  if (!next.signedIn)
    return {
      state: next,
      events: [...events, event("policy.blocked", "Sign in requires a person")],
    };
  if (key === "OPTIONS") {
    next.route = next.route === "apps" ? "settings" : "apps";
    next.focusIndex = 0;
    return { state: next, events };
  }
  if (key === "PLAY_PAUSE" && next.playback.contentId) {
    if (next.playback.state === "playing") next.playback.state = "paused";
    else startPlayback(next);
    return { state: next, events };
  }
  if (key === "REWIND" || key === "FAST_FORWARD") {
    if (next.route === "playback")
      next.playback.position = clamp(
        (next.playback.position ?? 0) + (key === "REWIND" ? -10 : 10),
        0,
        1320,
      );
    return { state: next, events };
  }
  const cards =
    next.route === "apps"
      ? APPS
      : next.route === "search"
        ? searchResults(next)
        : HOME_CONTENT;
  if (["home", "apps", "search"].includes(next.route)) {
    if (["LEFT", "UP", "RIGHT", "DOWN"].includes(key))
      next.focusIndex = clamp(
        next.focusIndex + (["LEFT", "UP"].includes(key) ? -1 : 1),
        0,
        Math.max(0, cards.length - 1),
      );
    if (key === "SELECT" && cards[next.focusIndex]) {
      if (next.route === "apps") {
        next.activeAppId = cards[next.focusIndex].id;
        next.route = "home";
        next.focusIndex = 0;
      } else open(next, cards[next.focusIndex].id);
    }
  } else if (next.route === "details") {
    if (
      next.playback.contentId === "bluey" &&
      ["RIGHT", "LEFT", "DOWN", "UP"].includes(key)
    ) {
      next.focusIndex = clamp(
        next.focusIndex + (["RIGHT", "DOWN"].includes(key) ? 1 : -1),
        0,
        12,
      );
      next.playback.episode = `Episode ${next.focusIndex + 1}`;
    }
    if (key === "SELECT") startPlayback(next);
  }
  events.push(
    event("tv.transition", `${next.route} · ${currentFocusLabel(next)}`),
  );
  return { state: next, events };
}
export function applyVoiceTranscript(
  state: TvState,
  transcript: string,
  confidence: number,
): TransitionResult {
  const next = structuredClone(state);
  next.voice = {
    ...next.voice,
    active: !!next.voice?.active,
    transcript,
    confidence,
  };
  const events = [event("stt.final", transcript, { confidence })];
  if (next.power === "off" || next.modal || !next.signedIn)
    return {
      state: next,
      events: [
        ...events,
        event(
          "policy.blocked",
          "Voice cannot bypass power, sign-in or confirmation",
        ),
      ],
    };
  if (confidence < 0.55 || !transcript.trim())
    return {
      state: next,
      events: [...events, event("voice.unresolved", "No confident speech")],
    };
  const normalized = transcript.toLowerCase().replace("three", "3");
  const card = HOME_CONTENT.find((c) =>
    normalized.includes(c.title.toLowerCase()),
  );
  if (card) {
    open(next, card.id);
    if (card.id === "bluey") {
      const episode = clamp(
        Number(normalized.match(/episode\s+(\d+)/)?.[1] ?? 1),
        1,
        13,
      );
      next.focusIndex = episode - 1;
      next.playback.episode = `Episode ${episode}`;
    }
    if (/\bplay\b/.test(normalized)) startPlayback(next);
  } else {
    next.route = "search";
    next.query = transcript;
    next.focusIndex = 0;
  }
  return {
    state: next,
    events: [...events, event("intent.resolve", next.route)],
  };
}
export function setNetwork(
  state: TvState,
  network: TvState["network"],
): TransitionResult {
  const next = structuredClone(state);
  next.network = network;
  if (network === "normal" && next.playback.state === "buffering")
    next.playback.state = "playing";
  if (network !== "normal" && next.playback.state === "playing")
    next.playback.state = "buffering";
  return { state: next, events: [event("fault.network", network)] };
}
export function launchApp(state: TvState, appId: string): TransitionResult {
  if (!APPS.some((a) => a.id === appId)) throw Error("Unknown app");
  if (state.modal || state.power === "off" || !state.signedIn)
    return {
      state,
      events: [event("policy.blocked", "App launch requires available TV")],
    };
  const next = structuredClone(state);
  next.activeAppId = appId;
  next.route = "home";
  next.focusIndex = 0;
  return { state: next, events: [event("app.launch", appId)] };
}
export function currentFocusLabel(state: TvState): string {
  if (state.life)
    return state.life.selected
      ? "Job details · Options cancels · Back returns"
      : state.life.draft
        ? "Submit instruction"
        : (LIFE_PROMPTS[state.focusIndex] ??
          state.life.jobs[state.focusIndex - 3]?.text ??
          "Life Center");
  if (state.modal === "profile")
    return state.focusIndex === 0 ? "Daniel" : "Kids";
  if (state.route === "home")
    return HOME_CONTENT[state.focusIndex]?.title ?? "Home";
  if (state.route === "apps") return APPS[state.focusIndex]?.title ?? "Apps";
  if (state.route === "search")
    return searchResults(state)[state.focusIndex]?.title ?? "No results";
  if (state.route === "details")
    return `${state.playback.title} ${state.playback.episode ?? ""}`;
  return state.route;
}
