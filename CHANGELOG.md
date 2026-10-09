# Changelog

## Unreleased

### Fixed

Materiality scoring counts only critic objections that target the claim under verification.

The critic still reviews generator proposals, and those proposals still add numbers, citations, and reasoning of their own. Objections tagged `[TARGET:proposal:N]` no longer increase `materialCount`, `notableCount`, or `minorCount`, no longer set `hasMaterialDefect`, and no longer apply the confidence penalty `1 - 0.3·material - 0.1·notable - 0.02·minor`. A harsh `[OVERALL:deficient|questionable]` does not cap claim confidence when every parsed objection is explicitly proposal-scoped. The `unverified-claims` flag ignores the word "unverified" when it appears only inside those proposal-scoped objections.

This is default-on whenever `classifyMateriality` is enabled. There is no new `verify()` option. Registry `pot-sdk@1.4.5` counted generator-proposal defects as defects of the user's claim, which blocked correct claims at stake `medium`.

### Compatibility

- Missing or garbled `[TARGET:...]` tags are scored as `claim`. Untagged critic output from older prompts scores as before, so a wrong claim is not treated as clean just because the tag was omitted.
- A `TARGET:proposal:N` tag aimed at a proposal whose model is `user-output` is scored as `claim`, because that text is the claim.
- `MaterialityObjection` gains optional `target`, `targetDefaulted`, and `scored` fields. `overallAssessment` stays the critic's raw label. `scoringOverallAssessment` is the value used for confidence caps.
- The public verdict enum is unchanged: `VERIFIED` | `UNVERIFIED` | `UNCERTAIN` | `DISSENT`.
