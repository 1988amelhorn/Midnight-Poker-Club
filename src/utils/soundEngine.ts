class CasinoSoundEngine {
  private ctx: AudioContext | null = null;
  private sfxEnabled = true;
  private musicEnabled = false;
  private sfxVolume = 0.75;
  private musicVolume = 0.25;
  private musicGain: GainNode | null = null;
  private musicOscs: OscillatorNode[] = [];
  private playedEventKeys = new Set<string>();

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (this.musicEnabled && this.musicOscs.length === 0) {
      this.startAmbientMusic();
    }
  }

  public configure(opts: { sfxEnabled?: boolean; musicEnabled?: boolean; sfxVolume?: number; musicVolume?: number }): void {
    if (opts.sfxEnabled !== undefined) this.sfxEnabled = opts.sfxEnabled;
    if (opts.sfxVolume !== undefined) this.sfxVolume = opts.sfxVolume;
    if (opts.musicVolume !== undefined) {
      this.musicVolume = opts.musicVolume;
      if (this.musicGain && this.ctx) {
        this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.08, this.ctx.currentTime, 0.1);
      }
    }
    if (opts.musicEnabled !== undefined) {
      this.musicEnabled = opts.musicEnabled;
      if (this.musicEnabled) this.startAmbientMusic();
      else this.stopAmbientMusic();
    }
  }

  public shouldPlayOnce(eventKey: string): boolean {
    if (this.playedEventKeys.has(eventKey)) return false;
    this.playedEventKeys.add(eventKey);
    if (this.playedEventKeys.size > 400) {
      const first = this.playedEventKeys.values().next().value;
      if (first) this.playedEventKeys.delete(first);
    }
    return true;
  }

  private getReadyContext(): AudioContext | null {
    if (!this.sfxEnabled || !this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  public playCardDeal(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.08;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(900, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.sfxVolume * 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  public playCardFlip(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.06);
    gain.gain.setValueAtTime(this.sfxVolume * 0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playShuffle(): void {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => this.playCardDeal(), i * 45);
    }
  }

  public playChipClick(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [2200, 3150].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.018);
      gain.gain.setValueAtTime(this.sfxVolume * 0.14, now + idx * 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.018 + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.018);
      osc.stop(now + idx * 0.018 + 0.05);
    });
  }

  public playChipSlide(): void {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.playChipClick(), i * 50);
    }
  }

  public playCheck(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.07);
    gain.gain.setValueAtTime(this.sfxVolume * 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  public playFold(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.14);
    gain.gain.setValueAtTime(this.sfxVolume * 0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playTurnWarning(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(this.sfxVolume * 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playHandWin(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(this.sfxVolume * 0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    });
    setTimeout(() => this.playChipSlide(), 220);
  }

  public playTournamentWin(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;
    const fanfare = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
    fanfare.forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(this.sfxVolume * 0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.48);
    });
  }

  private startAmbientMusic(): void {
    if (!this.ctx || this.ctx.state !== 'running' || this.musicOscs.length > 0) return;
    const gain = this.ctx.createGain();
    gain.gain.value = this.musicVolume * 0.08;
    gain.connect(this.ctx.destination);
    this.musicGain = gain;

    [110, 164.81, 220, 261.63].forEach((freq) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start();
      this.musicOscs.push(osc);
    });
  }

  private stopAmbientMusic(): void {
    for (const osc of this.musicOscs) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // ignore
      }
    }
    this.musicOscs = [];
    if (this.musicGain) {
      this.musicGain.disconnect();
      this.musicGain = null;
    }
  }
}

export const soundEngine = new CasinoSoundEngine();
