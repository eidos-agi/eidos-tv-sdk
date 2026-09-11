import type { RemoteEvent, RemoteKey, TvState } from '@eidos-tv/protocol';

export interface ContentCard {
  id: string;
  title: string;
  subtitle: string;
  kind: 'show' | 'movie' | 'app';
  accent: string;
}

export const HOME_CONTENT: ContentCard[] = [
  { id: 'bluey', title: 'Bluey', subtitle: 'S1 · 13 episodes', kind: 'show', accent: '#44a7ff' },
  { id: 'wild-robot', title: 'The Wild Robot', subtitle: 'Movie', kind: 'movie', accent: '#d59154' },
  { id: 'inside-out-2', title: 'Inside Out 2', subtitle: 'Movie', kind: 'movie', accent: '#9a67ff' },
  { id: 'fallout', title: 'Fallout', subtitle: 'Season 1', kind: 'show', accent: '#9a7a56' },
  { id: 'mandalorian', title: 'The Mandalorian', subtitle: 'Season 3', kind: 'show', accent: '#526473' },
];

export const APPS: ContentCard[] = [
  { id: 'video', title: 'Eidos Video', subtitle: 'Streaming', kind: 'app', accent: '#ff4f66' },
  { id: 'youtube', title: 'YouTube', subtitle: 'Video', kind: 'app', accent: '#ff3b30' },
  { id: 'netflix', title: 'Netflix', subtitle: 'Streaming', kind: 'app', accent: '#e50914' },
  { id: 'disney', title: 'Disney+', subtitle: 'Streaming', kind: 'app', accent: '#113ccf' },
  { id: 'prime', title: 'Prime Video', subtitle: 'Streaming', kind: 'app', accent: '#2d9cdb' },
];

export const INITIAL_TV_STATE: TvState = {
  power: 'on',
  route: 'home',
  focusIndex: 0,
  playback: { state: 'idle' },
  network: 'normal',
  volume: 35,
  muted: false,
  voice: { active: false },
};

export function createInitialTvState(): TvState {
  return structuredClone(INITIAL_TV_STATE);
}

export interface TransitionResult {
  state: TvState;
  events: Array<{ type: string; summary: string; payload?: unknown }>;
}

function event(type: string, summary: string, payload?: unknown) {
  return { type, summary, payload };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function withKey(state: TvState, key: RemoteKey): TransitionResult {
  const next = structuredClone(state);
  const events = [event('remote.key', key, { key })];

  if (key === 'POWER') {
    next.power = next.power === 'on' ? 'off' : 'on';
    events.push(event('tv.transition', `power → ${next.power}`));
    return { state: next, events };
  }

  if (next.power === 'off') {
    events.push(event('action.ignored', `${key} ignored while TV is off`));
    return { state: next, events };
  }

  if (key === 'HOME') {
    next.route = 'home';
    next.focusIndex = 0;
    next.modal = undefined;
    events.push(event('tv.transition', 'route → home'));
    return { state: next, events };
  }

  if (key === 'BACK') {
    if (next.route === 'playback') {
      next.route = 'details';
      next.playback.state = 'paused';
    } else if (next.route === 'details' || next.route === 'search' || next.route === 'apps') {
      next.route = 'home';
      next.focusIndex = 0;
    } else if (next.modal) {
      next.modal = undefined;
    }
    events.push(event('tv.transition', `back → ${next.route}`));
    return { state: next, events };
  }

  if (key === 'VOLUME_UP' || key === 'VOLUME_DOWN') {
    next.volume = clamp(next.volume + (key === 'VOLUME_UP' ? 5 : -5), 0, 100);
    next.muted = false;
    events.push(event('tv.volume', `volume → ${next.volume}`));
    return { state: next, events };
  }

  if (key === 'MUTE') {
    next.muted = !next.muted;
    events.push(event('tv.volume', next.muted ? 'muted' : 'unmuted'));
    return { state: next, events };
  }

  if (key === 'PLAY_PAUSE') {
    if (next.playback.contentId) {
      next.route = 'playback';
      next.playback.state = next.playback.state === 'playing' ? 'paused' : 'playing';
      events.push(event('playback.state', next.playback.state));
    }
    return { state: next, events };
  }

  if (next.route === 'home') {
    if (key === 'LEFT') next.focusIndex = clamp(next.focusIndex - 1, 0, HOME_CONTENT.length - 1);
    if (key === 'RIGHT') next.focusIndex = clamp(next.focusIndex + 1, 0, HOME_CONTENT.length - 1);
    if (key === 'UP') next.focusIndex = clamp(next.focusIndex - 2, 0, HOME_CONTENT.length - 1);
    if (key === 'DOWN') next.focusIndex = clamp(next.focusIndex + 2, 0, HOME_CONTENT.length - 1);

    if (['LEFT', 'RIGHT', 'UP', 'DOWN'].includes(key)) {
      events.push(event('tv.focus', HOME_CONTENT[next.focusIndex]?.title ?? 'unknown'));
    }

    if (key === 'SELECT') {
      const selected = HOME_CONTENT[next.focusIndex] ?? HOME_CONTENT[0];
      next.selectedContentId = selected.id;
      next.playback = {
        state: 'idle',
        contentId: selected.id,
        title: selected.title,
        episode: selected.id === 'bluey' ? 'Episode 3' : undefined,
      };
      next.route = 'details';
      events.push(event('content.open', selected.title, { contentId: selected.id }));
    }

    return { state: next, events };
  }

  if (next.route === 'details' && key === 'SELECT') {
    next.route = 'playback';
    next.playback.state = next.network === 'offline' ? 'buffering' : 'playing';
    events.push(event('playback.state', next.playback.state));
    return { state: next, events };
  }

  if (next.route === 'apps') {
    if (key === 'LEFT') next.focusIndex = clamp(next.focusIndex - 1, 0, APPS.length - 1);
    if (key === 'RIGHT') next.focusIndex = clamp(next.focusIndex + 1, 0, APPS.length - 1);
    if (key === 'SELECT') {
      const selected = APPS[next.focusIndex] ?? APPS[0];
      next.activeAppId = selected.id;
      next.route = 'home';
      next.focusIndex = selected.id === 'video' ? 0 : next.focusIndex;
      events.push(event('app.launch', selected.title, { appId: selected.id }));
    }
    return { state: next, events };
  }

  return { state: next, events };
}

export function reduceRemoteEvent(state: TvState, input: RemoteEvent): TransitionResult {
  if (input.type === 'key') {
    if (input.phase !== 'press') {
      return { state, events: [event(`remote.${input.phase}`, input.key, input)] };
    }
    return withKey(state, input.key);
  }

  if (input.type === 'text') {
    const next = structuredClone(state);
    next.route = 'search';
    return {
      state: next,
      events: [event('remote.text', input.text), event('search.query', input.text)],
    };
  }

  if (input.type === 'ptt' && input.phase === 'start') {
    const next = structuredClone(state);
    next.voice = { active: true };
    return { state: next, events: [event('ptt.started', input.sessionId)] };
  }

  if (input.type === 'ptt' && input.phase === 'stop') {
    const next = structuredClone(state);
    next.voice = { ...(next.voice ?? {}), active: false };
    return { state: next, events: [event('ptt.stopped', input.sessionId)] };
  }

  if (input.type === 'ptt.transcript') {
    return applyVoiceTranscript(state, input.text, input.confidence);
  }

  return { state, events: [] };
}

export function applyVoiceTranscript(state: TvState, transcript: string, confidence: number): TransitionResult {
  const next = structuredClone(state);
  next.voice = { active: true, transcript, confidence };
  const events = [event('stt.final', `“${transcript}” · ${Math.round(confidence * 100)}%`, { transcript, confidence })];
  const normalized = transcript.toLowerCase();

  if (confidence < 0.55) {
    events.push(event('voice.unresolved', 'confidence too low'));
    return { state: next, events };
  }

  if (normalized.includes('bluey')) {
    next.selectedContentId = 'bluey';
    next.playback = {
      state: normalized.includes('play') ? (next.network === 'offline' ? 'buffering' : 'playing') : 'idle',
      contentId: 'bluey',
      title: 'Bluey',
      episode: normalized.includes('episode three') || normalized.includes('episode 3') ? 'Episode 3' : 'Latest episode',
    };
    next.route = normalized.includes('play') ? 'playback' : 'details';
    events.push(event('intent.resolve', 'play Bluey', { contentId: 'bluey' }));
    events.push(event('tv.transition', `route → ${next.route}`));
    return { state: next, events };
  }

  next.route = 'search';
  events.push(event('intent.resolve', 'search', { query: transcript }));
  return { state: next, events };
}

export function setNetwork(state: TvState, network: TvState['network']): TransitionResult {
  const next = structuredClone(state);
  next.network = network;
  if (network === 'offline' && next.playback.state === 'playing') next.playback.state = 'buffering';
  return { state: next, events: [event('fault.network', network)] };
}

export function launchApp(state: TvState, appId: string): TransitionResult {
  const next = structuredClone(state);
  next.activeAppId = appId;
  next.route = 'home';
  next.focusIndex = 0;
  return { state: next, events: [event('app.launch', appId, { appId })] };
}

export function currentFocusLabel(state: TvState): string {
  if (state.route === 'home') return HOME_CONTENT[state.focusIndex]?.title ?? 'Home';
  if (state.route === 'apps') return APPS[state.focusIndex]?.title ?? 'Apps';
  if (state.route === 'details' || state.route === 'playback') return state.playback.title ?? 'Content';
  return state.route;
}
