# Mandatory GitHub Setup — Round 2

Official repository name:

`medddhir/aegis-innovahack-round2`

Add exactly one official organiser account as a collaborator:

- Preferred: `problemshooter`
- Fallback: `Sohamore`

Read access is sufficient for monitoring unless the organisers explicitly request write access.

## Push the preserved repository from Ubuntu

The downloadable project archive already contains the authentic `.git` history. Do **not** run `git init` again.

```bash
cd /root/aegis

git status
git log --oneline --decorate -10

gh repo create medddhir/aegis-innovahack-round2 \
  --public \
  --description "Aegis — independent financial guardrails and kill switch for autonomous AI agents" \
  --source=. \
  --remote=origin \
  --push
```

If the repository was created in the browser instead:

```bash
git remote add origin https://github.com/medddhir/aegis-innovahack-round2.git
git push -u origin main
```

## Add the organiser collaborator

```bash
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/medddhir/aegis-innovahack-round2/collaborators/problemshooter \
  -f permission=pull
```

Fallback:

```bash
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/medddhir/aegis-innovahack-round2/collaborators/Sohamore \
  -f permission=pull
```

Verify the invitation/permission:

```bash
gh api repos/medddhir/aegis-innovahack-round2/collaborators/problemshooter/permission
```

## Mandatory hourly commit protocol

Set a 50-minute timer. At each checkpoint, commit only genuine completed work:

```bash
cd /root/aegis
./scripts/hourly-checkpoint.sh "checkpoint: <honest description of completed work>"
```

The helper refuses to create an empty commit. Never fake, backdate, squash, or create empty checkpoints. Stop all commits before the official submission deadline.
