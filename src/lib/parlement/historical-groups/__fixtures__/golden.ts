/**
 * Reference output hashes of the two runs of the synthetic scenario, per resolver version.
 *
 * Why this exists: the run identity (`inputHash`) leaves the git revision out on purpose, so a
 * change of resolution logic that forgets to bump `RESOLVER_VERSION` would go unnoticed. These
 * hashes make it loud: change what a resolution answers and the reference test fails.
 *
 * To change the logic on purpose: bump `RESOLVER_VERSION`, add a NEW entry here, and explain the
 * change in the PR. Do not edit an existing entry: it records what that version answered.
 */
export const GOLDEN_OUTPUT_HASHES: Readonly<Record<string, { run1: string; run2: string }>> = {
  // Version 1 answered before diagnostics existed. The code that produced these hashes is gone:
  // the entry is kept as the record of what that version answered, and is no longer replayed.
  "1": {
    run1: "259686ab18f85ad8eda75d9c79804e61d8990fc9a4673164ee565097b85f02c9",
    run2: "6a5e016ea61531faca97f42678d6581aa4b2da9a9a6919f274da313ec72263b1",
  },
  // Version 2: a valid vote reports the interval evidence that cannot be placed (E2 indeterminate).
  "2": {
    run1: "a99049ef29b8e27af1a0d2e1b9b236cb575cb67e97346b152fbddbf2f870114a",
    run2: "7a67940cc11dfdd06d836c2acf26e86aa7ee3e7c864f1f16f5b9f020342eefcb",
  },
};
