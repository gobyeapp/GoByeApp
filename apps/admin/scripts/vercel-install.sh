#!/bin/sh
# Vercel install step for the admin (see DEPLOY_VERCEL.md). The admin needs the whole repository:
# the shared packages/core and the root lock file.
set -e
if [ ! -f ../../package.json ] || [ ! -d ../../packages/core ]; then
  echo 'GoBye admin needs the whole repository. In Vercel: Settings > Build and Deployment > Root Directory:'
  echo 'turn ON "Include files outside the root directory in the Build Step", then redeploy.'
  exit 1
fi
cd ../..
npm ci --workspace apps/admin --include-workspace-root=false --no-audit --no-fund
