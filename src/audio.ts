import type { AtmosphereEvent } from './tension';

/** Offline Web Audio foley. No network audio, microphone permission or voice imitation. */
export class Soundscape {
  private context?: AudioContext;
  private master?: GainNode;
  private world?: GainNode;
  private ambience?: GainNode;
  private danger?: GainNode;
  private reverb?: ConvolverNode;
  private noise?: AudioBuffer;
  private white?: AudioBuffer;
  private volume = .65;
  private muted = false;
  private active = false;
  private lastHeartbeat = 0;
  private breathTime = 0;
  private step = 0;
  private intro?: GainNode;
  private voice?: BiquadFilterNode;
  private outdoorNodes: AudioNode[] = [];
  private outdoorSources: AudioScheduledSourceNode[] = [];
  private clips = new Map<string, Promise<AudioBuffer | undefined>>();
  private voices = new Set<AudioBufferSourceNode>();

  async unlock() {
    if (!this.context) this.create();
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  private create() {
    const c = new AudioContext(); this.context = c;
    const master = this.master = c.createGain(); master.gain.value = this.muted ? 0 : this.volume;
    // Keep multiple layered sounds within a comfortable ceiling without clipping.
    const limiter = c.createDynamicsCompressor(); limiter.threshold.value = -10; limiter.knee.value = 12; limiter.ratio.value = 5; limiter.attack.value = .008; limiter.release.value = .22;
    master.connect(limiter).connect(c.destination);
    this.world = c.createGain(); this.world.gain.value = this.active ? 1 : 0; this.world.connect(master);
    this.ambience = c.createGain(); this.ambience.gain.value = 1; this.ambience.connect(this.world);
    this.danger = c.createGain(); this.danger.gain.value = 0; this.danger.connect(this.world);
    // Prologue bus: street ambience and dialogue bypass the Backrooms world mix.
    this.intro = c.createGain(); this.intro.gain.value = 1; this.intro.connect(master);
    this.voice = c.createBiquadFilter(); this.voice.type = 'lowpass'; this.voice.frequency.value = 18000; this.voice.Q.value = .5; this.voice.connect(this.intro);
    this.reverb = c.createConvolver();
    const impulse = c.createBuffer(2, Math.floor(c.sampleRate * 1.7), c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const samples = impulse.getChannelData(ch);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples.length, 3) * .55;
    }
    this.reverb.buffer = impulse;
    const wet = c.createGain(); wet.gain.value = .2; this.reverb.connect(wet).connect(this.world);
    for (const [frequency, amplitude] of [[50, .023], [100, .012], [150.3, .006], [201.2, .003]]) {
      const oscillator = c.createOscillator(), level = c.createGain(); oscillator.frequency.value = frequency; level.gain.value = amplitude;
      oscillator.connect(level).connect(this.ambience); oscillator.start();
      const modulation = c.createOscillator(), depth = c.createGain(); modulation.frequency.value = .13; depth.gain.value = amplitude * .17;
      modulation.connect(depth).connect(level.gain); modulation.start();
    }
    this.noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    this.white = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const brownSamples = this.noise.getChannelData(0), whiteSamples = this.white.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < brownSamples.length; i++) {
      whiteSamples[i] = Math.random() * 2 - 1;
      brown = (brown + whiteSamples[i] * .025) / 1.025; brownSamples[i] = brown * 3;
    }
    const hiss = c.createBufferSource(); hiss.buffer = this.noise; hiss.loop = true;
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 630;
    const hissGain = c.createGain(); hissGain.gain.value = .045; hiss.connect(filter).connect(hissGain).connect(this.ambience); hiss.start();
    const drone = c.createOscillator(); drone.frequency.value = 37; drone.connect(this.danger); drone.start();
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.context) return;
    this.world?.gain.setTargetAtTime(active ? 1 : 0, this.context.currentTime, active ? .25 : .12);
    if (!active) this.danger?.gain.setTargetAtTime(0, this.context.currentTime, .1);
  }
  setVolume(volume: number) { this.volume = volume; this.master?.gain.setTargetAtTime(this.muted ? 0 : volume, this.context!.currentTime, .08); }
  setMuted(muted: boolean) { this.muted = muted; this.master?.gain.setTargetAtTime(muted ? 0 : this.volume, this.context!.currentTime, .08); }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', endFrequency = frequency, delay = 0, pan = 0, world = false, destination?: AudioNode) {
    const c = this.context, output = destination ?? (world ? this.world : this.master);
    if (!c || !output) return;
    const now = c.currentTime + delay, oscillator = c.createOscillator(), gain = c.createGain(), stereo = c.createStereoPanner();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, now); oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume, now + Math.min(.012, duration * .2)); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    stereo.pan.value = Math.max(-1, Math.min(1, pan)); oscillator.connect(gain).connect(stereo).connect(output);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); stereo.disconnect(); };
    oscillator.start(now); oscillator.stop(now + duration + .03);
  }

  private burst(duration: number, amplitude: number, frequency: number, pan = 0, rate = 1, delay = 0, airy = false, echo = false, output?: AudioNode) {
    const c = this.context;
    if (!c || !this.world || !this.noise || !this.white) return;
    const source = c.createBufferSource(), filter = c.createBiquadFilter(), level = c.createGain(), stereo = c.createStereoPanner();
    source.buffer = airy ? this.white : this.noise; source.playbackRate.value = rate;
    filter.type = airy ? 'bandpass' : 'lowpass'; filter.frequency.value = frequency; filter.Q.value = airy ? .8 : .7;
    const now = c.currentTime + delay;
    level.gain.setValueAtTime(0, now); level.gain.linearRampToValueAtTime(amplitude, now + Math.min(.04, duration * .22)); level.gain.exponentialRampToValueAtTime(.0001, now + duration);
    stereo.pan.value = Math.max(-1, Math.min(1, pan)); source.connect(filter).connect(level).connect(stereo).connect(output ?? this.world);
    if (echo && this.reverb) stereo.connect(this.reverb);
    source.onended = () => { source.disconnect(); filter.disconnect(); level.disconnect(); stereo.disconnect(); };
    source.start(now, Math.random() * .8); source.stop(now + duration + .03);
  }

  click() { this.tone(780, .07, .023, 'sine', 410); }
  pickup() {
    this.burst(.22, .16, 2200, .1, 1.2); this.tone(1140, .3, .028, 'sine', 760, 0, .1, true);
    this.tone(1680, .18, .018, 'sine', 1200, .1, -.1, true);
  }
  toggle() { this.tone(180, .065, .065, 'triangle', 65, 0, -.15, true); this.burst(.23, .065, 1400, -.35, .9, .03, true); }
  note() { this.burst(.7, .1, 1900, -.15, 1.3, 0, true); this.tone(950, .08, .015, 'sine', 680, .12, 0, true); }
  hint() { this.burst(.4, .06, 2200, .1, 1, 0, true); this.tone(930, .14, .024, 'sine', 940, .08, 0, true); this.tone(1230, .16, .016, 'sine', 1200, .25, 0, true); }
  powerOn() {
    for (let i = 0; i < 4; i++) this.tone(100 + i * 20, .12, .065, 'triangle', 55, i * .13, (i % 2 - .5) * .5, true);
    this.tone(44, 1.7, .055, 'sawtooth', 85, .18, 0, true); this.burst(1.6, .18, 760, 0, .75, .25, false, true);
  }
  door(locked: boolean) {
    this.burst(locked ? .38 : 1, .2, locked ? 1600 : 600, .1, .8, 0, false, true);
    this.tone(locked ? 130 : 72, locked ? .18 : .7, .045, 'triangle', 40, .06, .2, true);
  }
  /** Short servo whine of the camcorder zoom motor. */
  zoomMotor() {
    this.tone(1850 + Math.random() * 120, .07, .006, 'square', 2050, 0, .08);
    this.tone(920, .06, .004, 'sawtooth', 980, .01, .08);
  }
  reveal() {
    this.burst(1.1, .15, 970, 0, .6, 0, true, true); this.tone(62, 1.3, .08, 'sawtooth', 28, 0, 0, true);
    this.tone(1220, .7, .018, 'sine', 180, .04, -.2, true);
  }

  footstep(sprint: boolean, wet = false) {
    const pan = ++this.step % 2 ? -.15 : .15;
    this.burst(sprint ? .21 : .17, sprint ? .25 : .15, wet ? 1250 : sprint ? 710 : 490, pan, .82 + Math.random() * .33);
    this.tone(60 + Math.random() * 20, .13, sprint ? .06 : .027, 'sine', 38, 0, pan, true);
    this.burst(.19, sprint ? .027 : .016, 1750, pan, 1, .05, true);
    if (wet) { this.burst(.24, .085, 2600, pan, 1.2, .06, true); this.tone(420, .065, .014, 'sine', 140, .04, pan, true); }
  }

  updateMotion(dt: number, stamina: number, sprint: boolean) {
    if (!this.active) return;
    const exertion = Math.max(sprint ? .45 : 0, 1 - stamina);
    this.breathTime -= dt;
    if (exertion > .24 && this.breathTime <= 0) {
      this.breathTime = 2.35 - exertion * .9;
      this.burst(.57, exertion * .065, 720, 0, .85, 0, true);
      this.burst(.64, exertion * .08, 950, 0, .7, .68, true);
    }
  }
  updateDanger(amount: number) {
    if (!this.context || !this.active) return;
    const time = this.context.currentTime; this.danger?.gain.setTargetAtTime(amount * .06, time, .4);
    if (amount > .2 && time - this.lastHeartbeat > 1.1 - amount * .5) {
      this.lastHeartbeat = time; this.tone(62, .16, amount * .085, 'sine', 38, 0, 0, true); this.tone(58, .12, amount * .05, 'sine', 35, .17, 0, true);
    }
  }
  creatureStep(distance: number, pan: number, muffled: boolean, revealed = false) {
    if (!this.active || distance > 20) return;
    const amplitude = Math.pow(Math.max(0, 1 - distance / 20), 1.6) * (muffled ? .42 : 1);
    if (amplitude < .005) return;
    this.burst(revealed ? .3 : .18, amplitude * (revealed ? .43 : .23), muffled ? 230 : revealed ? 860 : 540, pan, revealed ? .53 : .9 + Math.random() * .25, 0, false, true);
    this.tone(revealed ? 46 : 66, .18, amplitude * (revealed ? .05 : .022), 'sine', 32, 0, pan, true);
  }
  atmosphere(kind: AtmosphereEvent, pan: number) {
    if (!this.active) return;
    if (kind === 'drip') {
      for (let i = 0; i < 3; i++) { this.tone(1500 + Math.random() * 650, .13, .022 - i * .004, 'sine', 400, i * .51, pan, true); this.burst(.13, .04, 2200, pan, 1.5, i * .51, true, true); }
    } else if (kind === 'pipe') {
      this.tone(172, 1.7, .034, 'sine', 89, 0, pan, true); this.tone(345, .7, .016, 'triangle', 310, .1, pan, true); this.burst(.5, .08, 530, pan, .7, .2, false, true);
    } else if (kind === 'radio') {
      this.burst(.65, .065, 1650, pan, 1, 0, true, true); this.tone(1060, .09, .023, 'sine', 1030, .18, pan, true); this.burst(.35, .045, 920, pan, .8, .9, true, true);
    } else if (kind === 'echo') {
      for (let i = 0; i < 4; i++) this.burst(.22, .13 - i * .015, 420, pan, .8, i * .46, false, true);
    } else {
      this.burst(.7, .12, 2700, pan, .8, 0, true, true); this.tone(100, .3, .055, 'triangle', 42, .12, pan, true);
    }
  }
  knock() { this.atmosphere('pipe', Math.random() > .5 ? .7 : -.7); }
  /** The far figure is noticed: a slow, detuned swell under a thin tape whine. */
  stalkerSeen(pan: number) {
    if (!this.active) return;
    this.tone(49, 2.6, .06, 'sawtooth', 46, 0, pan, true); this.tone(51.5, 2.6, .05, 'sawtooth', 49, 0, pan, true);
    this.tone(2900, 1.8, .006, 'sine', 3100, .3, pan, true); this.burst(1.2, .03, 300, pan, .5, .2, false, true);
  }
  /** It is gone: a hard burst of tape static and something running away behind the walls. */
  stalkerVanish(pan: number) {
    if (!this.active) return;
    this.burst(.42, .17, 3200, 0, 1.3, 0, true, false);
    for (let i = 0; i < 6; i++) this.burst(.16, .1 - i * .012, 420, pan * (1 - i * .12), .6, .35 + i * .19, false, true);
  }
  /** Lights die near the warning wall and something heavy sprints past in the dark. */
  rushPast(pan: number) {
    if (!this.active) return;
    this.tone(36, 3.2, .09, 'sine', 30, 0, 0, true);
    for (let i = 0; i < 9; i++) { const side = pan * (-1 + i / 4); this.burst(.2, .2 - Math.abs(i - 4) * .03, 380, Math.max(-1, Math.min(1, side)), .55, .6 + i * .17, false, true); }
    this.burst(1.5, .05, 1800, -pan, .7, 2.1, true, true);
  }
  /** Unscrewing a cap and a couple of swallows. */
  drink() {
    if (!this.active) return;
    this.burst(.12, .05, 3400, 0, 1.6, 0, true); this.tone(310, .1, .03, 'sine', 180, .45);
    for (let i = 0; i < 3; i++) { this.tone(240 - i * 20, .14, .05, 'sine', 120, .75 + i * .38); this.burst(.1, .025, 700, 0, .9, .78 + i * .38); }
  }
  end(won: boolean) {
    this.setActive(false);
    if (won) this.tone(220, 3, .07, 'sine', 440);
    else { this.tone(57, 1.2, .105, 'sawtooth', 22); this.tone(290, .4, .035, 'triangle', 80); }
  }
  // ---- Found-footage prologue -------------------------------------------------------------

  /** Decode a bundled local dialogue clip once; failures fall back to subtitles only. */
  loadClip(url: string) {
    let clip = this.clips.get(url);
    if (!clip) {
      clip = (async () => {
        try {
          if (!this.context) this.create();
          const response = await fetch(url); if (!response.ok) return undefined;
          return await this.context!.decodeAudioData(await response.arrayBuffer());
        } catch { return undefined; }
      })();
      this.clips.set(url, clip);
    }
    return clip;
  }
  /** Play decoded dialogue on the prologue bus; returns the clip length in seconds (0 if unavailable). */
  playClip(buffer: AudioBuffer | undefined, gain = 1, pan = 0, delay = 0) {
    const c = this.context;
    if (!c || !this.voice || !buffer) return 0;
    const source = c.createBufferSource(), level = c.createGain(), stereo = c.createStereoPanner();
    source.buffer = buffer; level.gain.value = gain; stereo.pan.value = pan;
    source.connect(level).connect(stereo).connect(this.voice);
    this.voices.add(source);
    source.onended = () => { this.voices.delete(source); source.disconnect(); level.disconnect(); stereo.disconnect(); };
    source.start(c.currentTime + delay);
    return buffer.duration;
  }
  /** Sweep the dialogue low-pass: 1 = clear street air, 0 = heard through a floor. */
  muffleVoices(clarity: number, seconds = .4) {
    if (!this.context || !this.voice) return;
    this.voice.frequency.setTargetAtTime(260 + Math.pow(Math.max(0, Math.min(1, clarity)), 2) * 17700, this.context.currentTime, seconds / 3);
  }
  /** Warm-evening suburban air: wind in the trees, distant traffic rumble. Birds are scheduled by outdoorTick. */
  startOutdoor() {
    const c = this.context;
    if (!c || !this.intro || !this.noise || this.outdoorSources.length) return;
    this.intro.gain.cancelScheduledValues(c.currentTime); this.intro.gain.setValueAtTime(1, c.currentTime);
    this.muffleVoices(1, .05);
    const wind = c.createBufferSource(); wind.buffer = this.noise; wind.loop = true; wind.playbackRate.value = .6;
    const windFilter = c.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 520; windFilter.Q.value = .45;
    const windGain = c.createGain(); windGain.gain.value = .07;
    const gust = c.createOscillator(), gustDepth = c.createGain(); gust.frequency.value = .09; gustDepth.gain.value = .045;
    gust.connect(gustDepth).connect(windGain.gain);
    wind.connect(windFilter).connect(windGain).connect(this.voice!);
    const traffic = c.createBufferSource(); traffic.buffer = this.noise; traffic.loop = true; traffic.playbackRate.value = .35;
    const trafficFilter = c.createBiquadFilter(); trafficFilter.type = 'lowpass'; trafficFilter.frequency.value = 160;
    const trafficGain = c.createGain(); trafficGain.gain.value = .05;
    traffic.connect(trafficFilter).connect(trafficGain).connect(this.voice!);
    // Summer-evening cicadas: narrow high band of noise, pulsed by a fast tremolo and a slow swell.
    const cicada = c.createBufferSource(); cicada.buffer = this.noise; cicada.loop = true;
    const cicadaFilter = c.createBiquadFilter(); cicadaFilter.type = 'bandpass'; cicadaFilter.frequency.value = 5200; cicadaFilter.Q.value = 9;
    const cicadaGain = c.createGain(); cicadaGain.gain.value = .022;
    const pulse = c.createOscillator(), pulseDepth = c.createGain(); pulse.frequency.value = 31; pulseDepth.gain.value = .016;
    const swell = c.createOscillator(), swellDepth = c.createGain(); swell.frequency.value = .07; swellDepth.gain.value = .01;
    pulse.connect(pulseDepth).connect(cicadaGain.gain); swell.connect(swellDepth).connect(cicadaGain.gain);
    const cicadaPan = c.createStereoPanner(); cicadaPan.pan.value = .35;
    cicada.connect(cicadaFilter).connect(cicadaGain).connect(cicadaPan).connect(this.voice!);
    for (const source of [wind, gust, traffic, cicada, pulse, swell]) source.start();
    this.outdoorSources = [wind, gust, traffic, cicada, pulse, swell];
    this.outdoorNodes = [windFilter, windGain, gustDepth, trafficFilter, trafficGain, cicadaFilter, cicadaGain, pulseDepth, swellDepth, cicadaPan];
  }
  private birdTime = .4;
  private carTime = 9;
  private popTime = 3.5;
  outdoorTick(dt: number) {
    if (!this.context || !this.outdoorSources.length) return;
    this.birdTime -= dt; this.carTime -= dt; this.popTime -= dt;
    if (this.popTime <= 0) {
      // Fourth of July: a string of firecrackers a few streets away, dull and slightly echoing.
      this.popTime = 6 + Math.random() * 9;
      const pan = Math.random() * 1.4 - .7, count = 3 + Math.floor(Math.random() * 7);
      let at = 0;
      for (let i = 0; i < count; i++) { at += .05 + Math.random() * .18; this.burst(.06, .07 + Math.random() * .04, 900 + Math.random() * 900, pan, 1, at, false, false, this.voice); }
    }
    if (this.birdTime <= 0) {
      this.birdTime = .7 + Math.random() * 2.6;
      const pan = Math.random() * 1.6 - .8, base = 2600 + Math.random() * 1700, chirps = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < chirps; i++) this.tone(base, .07 + Math.random() * .05, .011, 'sine', base * (1.25 + Math.random() * .4), i * (.09 + Math.random() * .06), pan, false, this.voice);
    }
    if (this.carTime <= 0) {
      // A car passing a block away: a long filtered swell, panned across.
      this.carTime = 14 + Math.random() * 10;
      this.burst(4.5, .09, 380, Math.random() > .5 ? .6 : -.6, .5, 0, false, false, this.voice);
    }
  }
  /** Scuff of sneakers on dry asphalt. */
  streetStep() {
    const pan = ++this.step % 2 ? -.12 : .12;
    this.burst(.14, .1, 1500, pan, 1 + Math.random() * .3, 0, true, false, this.intro);
    this.tone(90, .09, .02, 'sine', 50, 0, pan, false, this.intro);
  }
  /** Heel catching the kerb, then the tape mechanism shrieking as reality gives way. */
  noclip() {
    const c = this.context;
    if (!c || !this.intro) return;
    this.burst(.18, .3, 900, 0, .9, 0, false, false, this.intro);
    this.tone(70, .25, .08, 'sine', 40, 0, 0, false, this.intro);
    this.burst(1.6, .22, 2400, 0, 1.4, .35, true, false, this.intro);
    this.tone(1900, 1.4, .03, 'sawtooth', 120, .4, 0, false, this.intro);
    this.tone(55, 1.6, .05, 'square', 30, .45, 0, false, this.intro);
    this.muffleVoices(.15, 1.1);
  }
  /** Body hitting damp carpet in silence. */
  landing() {
    this.tone(48, .55, .14, 'sine', 26); this.burst(.35, .25, 300, 0, .7);
    this.tone(120, .12, .04, 'triangle', 60, .05);
  }
  /** Fade and stop every prologue sound (also used when the player skips). */
  stopIntro(seconds = .35) {
    const c = this.context;
    if (!c || !this.intro) return;
    const now = c.currentTime;
    this.intro.gain.cancelScheduledValues(now); this.intro.gain.setValueAtTime(this.intro.gain.value, now); this.intro.gain.linearRampToValueAtTime(0, now + seconds);
    for (const source of this.outdoorSources) try { source.stop(now + seconds + .05); } catch { /* already stopped */ }
    for (const voice of this.voices) try { voice.stop(now + seconds + .05); } catch { /* already stopped */ }
    const nodes = this.outdoorNodes; this.outdoorSources = []; this.outdoorNodes = [];
    window.setTimeout(() => nodes.forEach(node => node.disconnect()), (seconds + .2) * 1000);
  }
  dispose() { void this.context?.close(); this.context = undefined; }
}
