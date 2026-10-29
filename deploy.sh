#!/usr/bin/env sh
set -e
: "${PROJECT:?set PROJECT to your Google Cloud project id}"
REGION=${REGION:-europe-west1}
SERVICE=${SERVICE:-aimesis-cds}
: "${ADMIN_KEY:?set ADMIN_KEY first (guards the demo data reset)}"
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)' 2>/dev/null || true)

ENV_VARS="USE_LLM=${USE_LLM:-false},GCP_PROJECT_ID=$PROJECT,GCP_LOCATION=$REGION,PUBLIC_BASE_URL=${URL:-http://placeholder},ADMIN_KEY=$ADMIN_KEY"

echo "Deploying ${SERVICE} to Cloud Run (Public demo mode)..."
gcloud run deploy "$SERVICE" --source . --project "$PROJECT" --region "$REGION" \
  --allow-unauthenticated --min-instances 1 --max-instances 1 \
  --set-env-vars "$ENV_VARS"
