/** Injectable "now". Services never read the wall clock directly — tests pin it. */
export const CLOCK = Symbol('CLOCK');
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
