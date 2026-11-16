export class Soundscape {
  private context?: AudioContext;
  private master?: GainNode;
  private ambience?: GainNode;
  private danger?: GainNode;
  private noise?: AudioBuffer;
  private volume = 0.65;
  private muted = false;
  private active = false;
  private lastHeartbeat = 0;

  async unlock() {
    if (!this.context) this.create();
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  private create() {
    const context = new AudioContext();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(context.destination);
    this.ambience = context.createGain();
    this.ambience.gain.value = 0;
    this.ambience.connect(this.master);
    this.danger = context.createGain();
    this.danger.gain.value = 0;
    this.danger.connect(this.master);

    for (const [frequency, gain] of [[50, 0.024], [100, 0.014], [150.3, 0.007], [201.2, 0.003]]) {
      const oscillator = context.createOscillator();
      const level = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      level.gain.value = gain;
      oscillator.connect(level).connect(this.ambience);
      oscillator.start();
      const modulation = context.createOscillator();
      const depth = context.createGain();
      modulation.frequency.value = 0.12;
      depth.gain.value = gain * 0.15;
      modulation.connect(depth).connect(level.gain);
      modulation.start();
    }

    this.noise = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const channel = this.noise.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < channel.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.025) / 1.025;
      channel[i] = brown * 3;
    }
    const hiss = context.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 630;
    const hissGain = context.createGain();
    hissGain.gain.value = 0.045;
    hiss.connect(filter).connect(hissGain).connect(this.ambience);
    hiss.start();

    const drone = context.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 37;
    drone.connect(this.danger);
    drone.start();
  }

  setActive(active: boolean) {
    this.active = active;
    if (!this.context) return;
    this.ambience?.gain.setTargetAtTime(active ? 1 : 0, this.context.currentTime, 0.8);
    if (!active) this.danger?.gain.setTargetAtTime(0, this.context.currentTime, 0.2);
  }

  setVolume(volume: number) {
    this.volume = volume;
    this.master?.gain.setTargetAtTime(this.muted ? 0 : volume, this.context!.currentTime, 0.08);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.master?.gain.setTargetAtTime(muted ? 0 : this.volume, this.context!.currentTime, 0.08);
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', endFrequency?: number) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.05);
  }

  click() { this.tone(780, 0.07, 0.025, 'sine', 410); }
  pickup() {
    this.tone(520, 0.25, 0.06, 'sine', 840);
    window.setTimeout(() => this.tone(1040, 0.35, 0.035), 100);
  }
  toggle() { this.tone(180, 0.07, 0.08, 'triangle', 65); }
  powerOn() {
    this.tone(45, 2, 0.12, 'sawtooth', 110);
    window.setTimeout(() => this.tone(720, 1.4, 0.04), 700);
  }
  footstep(sprint: boolean) {
    if (!this.context || !this.master || !this.noise) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = sprint ? 740 : 480;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(sprint ? 0.28 : 0.16, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now, Math.random());
    source.stop(now + 0.23);
    this.tone(60 + Math.random() * 20, 0.15, sprint ? 0.07 : 0.035, 'sine', 38);
  }

  updateDanger(amount: number) {
    if (!this.context || !this.active) return;
    const time = this.context.currentTime;
    this.danger?.gain.setTargetAtTime(amount * 0.06, time, 0.4);
    if (amount > 0.2 && time - this.lastHeartbeat > 1.1 - amount * 0.5) {
      this.lastHeartbeat = time;
      this.tone(62, 0.16, amount * 0.1, 'sine', 38);
      window.setTimeout(() => this.tone(58, 0.12, amount * 0.06, 'sine', 35), 170);
    }
  }

  creatureStep(distance: number, pan: number, muffled: boolean) {
    if (!this.context || !this.master || !this.noise || !this.active || distance > 20) return;
    const amplitude = Math.pow(Math.max(0, 1 - distance / 20), 1.6) * (muffled ? 0.5 : 1);
    if (amplitude < 0.005) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.48 + Math.random() * 0.12;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = muffled ? 260 : 820;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(amplitude * 0.5, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    const panner = this.context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(filter).connect(gain).connect(panner).connect(this.master);
    source.start(now, Math.random());
    source.stop(now + 0.35);
    this.tone(46, 0.23, amplitude * 0.055, 'sine', 28);
  }

  knock() {
    this.tone(120, 0.2, 0.06, 'triangle', 40);
    window.setTimeout(() => this.tone(100, 0.2, 0.04, 'triangle', 40), 280);
  }

  end(won: boolean) {
    this.setActive(false);
    if (won) this.tone(220, 3, 0.075, 'sine', 440);
    else {
      this.tone(57, 1.2, 0.14, 'sawtooth', 22);
      this.tone(290, 0.4, 0.045, 'triangle', 80);
    }
  }
}
