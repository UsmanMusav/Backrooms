/** Frame-rate-independent first-person motion. Does not change the authoritative X/Z position. */
const damp = (current: number, target: number, speed: number, dt: number) => current + (target - current) * (1 - Math.exp(-speed * dt));
export class FirstPersonMotion {
  phase = 0;
  amount = 0;
  pace = 0;
  raised = 0;
  private lean = 0;
  private turnX = 0;
  private turnY = 0;
  private breath = 0;
  private height = 0;

  reset(raised = false) { this.phase = this.amount = this.pace = this.lean = this.turnX = this.turnY = this.breath = this.height = 0; this.raised = raised ? 1 : 0; }
  look(yaw: number, pitch: number) { this.turnX = Math.max(-.12, Math.min(.12, this.turnX + yaw)); this.turnY = Math.max(-.09, Math.min(.09, this.turnY + pitch)); }
  update(delta: number, moving: boolean, sprint: boolean, strafe: number, enabled: boolean, flashOn: boolean) {
    const dt = Math.max(0, Math.min(.1, delta));
    this.amount = damp(this.amount, enabled && moving ? 1 : 0, 9, dt);
    this.pace = damp(this.pace, sprint ? 1 : 0, 5, dt);
    this.phase += dt * (9.6 + this.pace * 4.4) * this.amount;
    this.breath += dt;
    this.lean = damp(this.lean, enabled ? strafe : 0, 8, dt);
    this.turnX = damp(this.turnX, 0, 10, dt); this.turnY = damp(this.turnY, 0, 10, dt);
    this.raised = damp(this.raised, flashOn ? 1 : 0, flashOn ? 10 : 13, dt);
    if (Math.abs(this.raised - (flashOn ? 1 : 0)) < .002) this.raised = flashOn ? 1 : 0;
    const bounce = Math.sin(this.phase) * (.033 + this.pace * .027) * this.amount;
    const breathing = Math.sin(this.breath * 1.65) * .003 * (1 - this.amount * .6);
    this.height = enabled ? damp(this.height, bounce + breathing, 20, dt) : 0;
    const sway = enabled ? Math.sin(this.phase * .5) * this.amount : 0;
    return {
      height: this.height,
      roll: enabled ? sway * (.007 + this.pace * .004) - this.lean * .009 + this.turnX * .025 : 0,
      pitch: enabled ? Math.cos(this.phase) * this.amount * .0025 : 0,
      handX: enabled ? sway * (.013 + this.pace * .009) - this.turnX * .22 : 0,
      handY: enabled ? -bounce * .36 + breathing * 1.7 + this.turnY * .12 : 0,
      handYaw: enabled ? -this.turnX * .8 + sway * .012 : 0,
      handRoll: enabled ? -sway * .018 + this.lean * .028 : 0,
      draw: this.raised * this.raised * (3 - 2 * this.raised),
      visible: this.raised > .008,
      fov: 72 + (enabled ? this.pace * 4 : 0),
    };
  }
}
