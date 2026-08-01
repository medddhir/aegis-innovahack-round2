# Mandatory GitHub Monitoring Protocol

## Organiser collaborator

Add either:

- `problemshooter`
- `Sohamore`

Recommended CLI command after the remote repository exists:

```bash
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/medddhir/aegis-innovahack-round2/collaborators/problemshooter \
  -f permission=push
```

If the first account cannot be invited, replace `problemshooter` with `Sohamore`.

## Hourly commit rule

Make at least one **genuine development checkpoint every hour**. Do not create empty, fake or backdated commits.

Recommended pattern:

```bash
git status --short
git add -A
git commit -m "checkpoint: <real work completed during this hour>"
git push origin main
```

## Suggested checkpoints

- Foundation and deterministic policy engine
- Budget Capsules and policy controls
- Risk Governor and Evasion Shield
- Two-phase settlement and freeze flow
- Policy Twin and attack scenarios
- Forensic ledger and replay
- Reliability tests and responsive polish
- Deployment and submission documentation

## Deadline safety

Stop all commits before the official submission deadline. Preserve the final commit SHA and release tag in the submission package.
