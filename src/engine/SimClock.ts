/**
 * Simulation clock driving propagation and Earth rotation.
 * `speed` is a multiplier on real time; negative values run backwards.
 */
export class SimClock {
  simMs: number = Date.now();
  speed = 1;
  playing = true;

  tick(realDtMs: number): void {
    if (this.playing) this.simMs += realDtMs * this.speed;
  }

  setSpeed(s: number): void {
    this.speed = s;
  }

  jump(deltaMs: number): void {
    this.simMs += deltaMs;
  }

  resetToNow(): void {
    this.simMs = Date.now();
    this.speed = 1;
    this.playing = true;
  }
}
