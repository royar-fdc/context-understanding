/**
 * Tiny seeded PRNG (mulberry32) so every dataset and every simulated model run
 * is fully reproducible. Reproducibility matters here: a benchmark whose cases
 * change between runs cannot support a falsifiable claim.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force to unsigned 32-bit.
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Pick a random element. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}
