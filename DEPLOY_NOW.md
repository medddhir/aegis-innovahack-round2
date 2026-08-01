# Deploy Aegis Now

The repository contains preserved authentic commit history and is Vercel-ready.

## 1. Create and push the official public repository

```bash
cd /root/aegis

gh repo create medddhir/aegis-innovahack-round2 \
  --public \
  --source=. \
  --remote=origin \
  --push \
  --description "Aegis — independent financial guardrails and kill switch for autonomous AI agents"
```

If the repository was already created in the browser:

```bash
git remote add origin https://github.com/medddhir/aegis-innovahack-round2.git
git push -u origin main
```

## 2. Add the mandatory organiser collaborator

```bash
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/medddhir/aegis-innovahack-round2/collaborators/problemshooter \
  -f permission=pull
```

If that fails, use:

```bash
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/medddhir/aegis-innovahack-round2/collaborators/Sohamore \
  -f permission=pull
```

Verify:

```bash
gh api repos/medddhir/aegis-innovahack-round2/collaborators/problemshooter/permission
```

## 3. Deploy to Vercel

```bash
cd /root/aegis
npm run build

# Install once if required
npm install -g vercel

# First authentication only
vercel login

# Production deployment
vercel --prod --yes --name aegis-innovahack-round2
```

The build command is `npm run build`; the output directory is `dist`.

## 4. Preserve hourly evidence

At least once every hour, after real work:

```bash
./scripts/hourly-checkpoint.sh "checkpoint: <real work completed>"
```

Never make an empty or backdated commit, and stop all commits before the official deadline.
