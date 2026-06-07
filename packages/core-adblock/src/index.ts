/** Phase 6 — domain blocklist engine */
export const ADBLOCK_PHASE = 6;

export {
  AdblockEngine,
  mergeRuleSets,
  parseBundledList,
  type AdblockDecision,
  type AdblockMatchInput,
  type AdblockResourceType,
  type AdblockRuleSetInput,
} from './engine';
