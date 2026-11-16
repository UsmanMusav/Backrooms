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

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', endFrequency = frequency, delay = 0, pan = 0, world = false) {
    const c = this.context, output = world ? this.world : this.master;
    if (!c || !output) return;
    const now = c.currentTime + delay, oscillator = c.createOscillator(), gain = c.createGain(), stereo = c.createStereoPanner();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, now); oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume, now + Math.min(.012, duration * .2)); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    stereo.pan.value = Math.max(-1, Math.min(1, pan)); oscillator.connect(gain).connect(stereo).connect(output);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); stereo.disconnect(); };
    oscillator.start(now); oscillator.stop(now + duration + .03);
  }

  private burst(duration: number, amplitude: number, frequency: number, pan = 0, rate = 1, delay = 0, airy = false, echo = false) {
    const c = this.context;
    if (!c || !this.world || !this.noise || !this.white) return;
    const source = c.createBufferSource(), filter = c.createBiquadFilter(), level = c.createGain(), stereo = c.createStereoPanner();
    source.buffer = airy ? this.white : this.noise; source.playbackRate.value = rate;
    filter.type = airy ? 'bandpass' : 'lowpass'; filter.frequency.value = frequency; filter.Q.value = airy ? .8 : .7;
    const now = c.currentTime + delay;
    level.gain.setValueAtTime(0, now); level.gain.linearRampToValueAtTime(amplitude, now + Math.min(.04, duration * .22)); level.gain.exponentialRampToValueAtTime(.0001, now + duration);
    stereo.pan.value = Math.max(-1, Math.min(1, pan)); source.connect(filter).connect(level).connect(stereo).connect(this.world);
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
  end(won: boolean) {
    this.setActive(false);
    if (won) this.tone(220, 3, .07, 'sine', 440);
    else { this.tone(57, 1.2, .105, 'sawtooth', 22); this.tone(290, .4, .035, 'triangle', 80); }
  }
  dispose() { void this.context?.close(); this.context = undefined; }
}
