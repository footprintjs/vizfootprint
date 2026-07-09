/**
 * vizfootprint online-FDR layer (packet X2).
 *
 * Two online multiple-testing procedures, implemented exactly from the primary
 * literature, over a stream of declared analyses:
 *
 *   - LORD++          Ramdas, Yang, Wainwright & Jordan (2017), NeurIPS 30
 *                     — controls FDR under independence.
 *   - alpha-investing Foster & Stine (2008), JRSS-B 70(2)
 *                     — controls mFDR (a ratio of expectations).
 *
 * They serve invariants R6 (declared hypotheses), R7 (ONLINE correction —
 * batch is wrong under adaptive arrival) and R8 (dead ends stay in the
 * denominator; wealth spent is never refunded). See ./types.ts.
 *
 * Both are exposed twice: a streaming stepper (`create*`) for true online use
 * that L3/L1 drive one record at a time, and a pure whole-stream fold.
 */

export type {
  HypothesisRecord,
  FdrStep,
  FdrRun,
  GammaSequence,
} from './types.js';

export {
  lordGamma,
  lordGammaShape,
  lordGammaOnlineFDR,
  LORD_GAMMA_CONSTANT,
  LORD_GAMMA_CONSTANT_ONLINEFDR,
  sumGamma,
  normalizingConstant,
} from './gamma.js';

export { hypothesisRecordsFromLog, branchIdFromLog, TEST_ANALOG_FIELD } from './fromLog.js';

export {
  lordPlusPlus,
  createLordPlusPlus,
  type LordPlusPlusOptions,
  type LordPlusPlusState,
} from './lordPlusPlus.js';

export {
  alphaInvesting,
  createAlphaInvesting,
  type AlphaInvestingOptions,
  type AlphaInvestingState,
} from './alphaInvesting.js';

export { makeRng, mulberry32, normalVector, type Rng } from './rng.js';
