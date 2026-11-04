/**
 * Drives ONE booking through its whole lifecycle against a Clickco API that has the dev tools on
 * (DEV_TOOLS=on: local, or a disposable load-test stack — never staging or production, where
 * the /dev routes do not exist). Prints a PASS/FAIL line per step. See README.md.
 *
 *   apps/api/node_modules/.bin/tsx scripts/dry-run/run.ts [--api http://localhost:4000]
 *   … --resume            continue a run paused before check-out
 *
 * Exit codes: 0 all passed · 1 a step failed · 2 bad options · 3 paused (re-run with --resume).
 */
import { RunContext, type Step } from './context.js';
import { type DryRunOptions, parseOptions } from './options.js';
import { describeError, line, StepNotYet } from './report.js';
import { freshState, loadState } from './state.js';
import { BOOKING_STEPS } from './steps-booking.js';
import { DELIVERY_STEPS } from './steps-delivery.js';

const STEPS: readonly Step[] = [...BOOKING_STEPS, ...DELIVERY_STEPS];

const out = (text: string) => process.stdout.write(`${text}\n`);

function header(options: DryRunOptions, ctx: RunContext): void {
  out(`Clickco dry run → ${options.api}`);
  out(`state file ${options.stateFile} (holds session tokens: delete it after the run)`);
  if (ctx.state.bookingReference)
    out(`booking ${ctx.state.bookingReference} (${ctx.state.bookingId})`);
  out('');
}

async function runSteps(ctx: RunContext): Promise<number> {
  for (const [i, step] of STEPS.entries()) {
    const n = i + 1;
    if (ctx.state.done.includes(step.id)) {
      out(line('SKIP', n, step.name, 'passed in an earlier run'));
      continue;
    }
    const began = Date.now();
    try {
      const detail = await step.run(ctx);
      ctx.markDone(step.id);
      out(line('PASS', n, step.name, detail, Date.now() - began));
    } catch (error) {
      if (error instanceof StepNotYet) {
        out(line('WAIT', n, step.name, `${error.message}; resume after ${error.until}`));
        out(
          `\nPaused. Re-run with --resume --state ${ctx.options.stateFile} after ${error.until},`,
        );
        out('or now with --max-wait-minutes <n> to wait in this process.');
        return 3;
      }
      out(line('FAIL', n, step.name, describeError(error), Date.now() - began));
      return 1;
    }
  }
  out(`\nAll ${STEPS.length} steps passed for ${ctx.state.bookingReference}.`);
  return 0;
}

async function main(): Promise<number> {
  let options: DryRunOptions;
  try {
    options = parseOptions(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return 2;
  }
  const state = options.resume
    ? loadState(options.stateFile)
    : freshState(options.api, options.clientPhone, new Date());
  if (state.api !== options.api) {
    process.stderr.write(`The saved run targets ${state.api}, not ${options.api}\n`);
    return 2;
  }
  const ctx = new RunContext(options, state);
  header(options, ctx);
  return runSteps(ctx);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`dry run crashed: ${describeError(error)}\n`);
    process.exitCode = 1;
  },
);
