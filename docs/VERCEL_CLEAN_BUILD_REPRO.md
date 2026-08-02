# Vercel clean-build reproduction

Reproduced on 2026-08-02 from a fresh clone of commit `d6fd394a3050997ba657d5926f6ca76a77a367cc`.

The clone received only root production dependencies. No tests, contract commands, or proof-generation commands were run before the production build.

```text
$ npm ci
added 1 package

$ npm run build
> npm run proof:check && node build.mjs
> node scripts/generate-project-proof.mjs --check

Error: ENOENT: no such file or directory, open '<clean-clone>/contracts/test-results.json'
    at async readFile (node:internal/fs/promises:1249:14)
    at async json (scripts/generate-project-proof.mjs:8:39)
```

The ignored local files present in the warm development workspace but absent from Git were:

- `contracts/test-results.json`
- `contracts/parity-results.json`
- `contracts/attack-report.json`

The production repair makes `proof:check` validate tracked source and committed proof evidence only. `proof:refresh` remains the explicit local-EVM path that regenerates those artifacts before updating the committed public proof.
