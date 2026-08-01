# Mandatory GitHub Setup

Create a public repository named `aegis-innovahack` under `medddhir`.

Add at least one official organiser as a collaborator:
- `problemshooter`
- `Sohamore`

Recommended: add both so monitoring access is not blocked by a pending invitation.

## Push from Ubuntu

```bash
cd /root
mkdir -p aegis-innovahack
# Copy the downloaded project contents into /root/aegis-innovahack first.
cd /root/aegis-innovahack

git init
git branch -M main
git config user.name "Medhir Lokhande"
git config user.email "medhir@turbo-pay.in"
git add .
git commit -m "feat: launch Aegis financial guardrail prototype"

gh repo create medddhir/aegis-innovahack \
  --public \
  --description "Aegis — independent financial guardrails and kill switch for autonomous AI agents" \
  --source=. \
  --remote=origin \
  --push
```

If the repository was created in the browser instead:

```bash
git remote add origin https://github.com/medddhir/aegis-innovahack.git
git push -u origin main
```

## Add organiser collaborator

Browser path:

`Repository → Settings → Collaborators → Add people`

Add `problemshooter` and/or `Sohamore`.

## Hourly commit rule

At each meaningful checkpoint:

```bash
git status
git add .
git commit -m "<honest description of the completed work>"
git push
```

Do not use empty, fake, squashed, or backdated commits.
