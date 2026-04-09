---
name: hosting
description: Hosting Remotion Studio for internal teams (Railway, Render.com, Fly.io). Why Vercel doesn't work. Licensing.
metadata:
  tags: hosting, deployment, railway, vercel, lambda, licensing
---

## Why Vercel doesn't work for Studio hosting

Vercel is serverless. The Remotion Studio is a long-running Node.js dev server that:

- Needs a persistent process (websocket + file watcher)
- Launches headless Chromium + FFmpeg at render time
- Writes MP4 files to the local filesystem
- Has no request-response boundary the serverless model expects

A static build (`remotion bundle` → Vercel) gives you the PREVIEW but the **Render button is disabled** because there's no server to run Chromium.

## What works for Studio hosting (internal teams only)

**Railway, Render.com, Fly.io** — managed platforms that run persistent Node.js processes with Docker or Nixpacks.

### Railway (recommended, simplest)

```toml
# /railway.toml
[build]
builder = "nixpacks"
buildCommand = "pnpm install"

[build.nixpacksPlan.phases.setup]
aptPkgs = ["ffmpeg", "chromium", "fonts-liberation"]

[deploy]
startCommand = "cd remotion && npx remotion studio --host 0.0.0.0 --port $PORT"
restartPolicyType = "ON_FAILURE"
```

Then:

```bash
npm i -g @railway/cli
railway login
railway init
railway up
railway domain  # custom domain
```

- **Cost**: ~$5-15/month depending on render frequency
- **Auth**: put Cloudflare Access in front (free for small teams, SSO with Google Workspace)
- **DX**: git push → deploy, same as Vercel

### Render.com

Dockerfile required:

```dockerfile
FROM node:20
RUN apt-get update && apt-get install -y ffmpeg chromium
WORKDIR /app
COPY . .
RUN npm i -g pnpm && pnpm install
EXPOSE 3000
CMD cd remotion && pnpm studio --host 0.0.0.0 --port 3000
```

$7/mo for 2GB RAM (the free tier's 512MB is too small for render).

### Fly.io

Cheapest if you know Docker ($3/mo on shared 2 vCPU / 2GB). Config via `fly.toml` + Dockerfile.

## Why Studio hosting is ONLY for internal teams

The Remotion Studio has:

- **No built-in auth** → anyone with the URL can trigger renders
- **No rate limiting** → a bot can saturate CPU and bankrupt you
- **No multi-user isolation** → concurrent renders share the same process, can fail or produce mixed results
- **Props panel UI is dev-oriented** → JSON editor, timeline, composition list — not suitable for end users

For a marketing team of 5-10 people sharing a Studio behind Cloudflare Access, it's fine. For `replay.nums.gg` as a public feature, use the Lambda pattern instead.

## For public end-user video generation: use Lambda

The canonical production pattern:

```
Frontend (Next.js/Vite)
  ├─ <Player component={Replay} inputProps={{ gameId }} />  ← preview
  └─ "Export video" button → POST /api/render
                               → renderMediaOnLambda({ inputProps })
                               → return S3 presigned URL
```

Setup:

```bash
npm i @remotion/lambda
npx remotion lambda functions deploy --region us-east-1
npx remotion lambda sites create src/index.ts --site-name=nums-replay
```

Trigger renders from a backend API route:

```ts
import {
  renderMediaOnLambda,
  getRenderProgress,
} from "@remotion/lambda/client";

const { renderId, bucketName } = await renderMediaOnLambda({
  region: "us-east-1",
  functionName: "remotion-render-xyz",
  composition: "replay",
  serveUrl: "https://remotionlambda-xyz.s3.amazonaws.com/sites/nums-replay",
  codec: "h264",
  inputProps: { gameId, numsPrice: 0.0115 },
});

// Poll progress, then return presigned S3 URL
```

**Cost**: ~$0.001-0.02 per minute of rendered video. A 30-second replay ≈ $0.005 in compute.

## Licensing

Remotion is free for:

- Individuals
- Companies with ≤3 employees
- Non-profits
- Evaluation / early stage

For commercial use at a company with 4+ employees:

| License                     | Price                     | Use case                             |
| --------------------------- | ------------------------- | ------------------------------------ |
| **Remotion for Creators**   | $25/seat/month            | Internal team rendering videos       |
| **Remotion for Automators** | $0.01/render, $100/mo min | SaaS where end users generate videos |

For the Nums case specifically:

- **Studio for marketing team** (5-10 people) → Creators license, ~$125-250/mo
- **Public "export my replay" feature** → Automators license, $100/mo min + $0.01/render

Consult remotion.dev/license for the current terms.

## Decision tree

```
Who uses it?
│
├─ Marketing team only (5-10 people, internal)
│  → Host Studio on Railway ($5-15/mo) + Cloudflare Access
│  → Creators license ($25/seat/mo)
│  → Total: ~$130-265/mo
│
├─ Public users (anyone with a Nums game)
│  → Vercel Next.js app with <Player /> for preview
│  → Backend API → @remotion/lambda → S3
│  → Automators license ($100/mo min + $0.01/render)
│  → Total: ~$110-200/mo for <10k renders
│
└─ Prototype / evaluation (just you)
   → Local `pnpm remotion:studio`
   → Free license
   → Total: $0
```

## Related

- `.agents/skills/remotion-best-practices/rules/parameters.md` — Zod schemas for input props (required for Lambda)
- `remotion/src/root.tsx` — Current `calculateMetadata` + `defaultProps` setup compatible with Lambda
