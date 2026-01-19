#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-}"
if [[ "$TARGET" != "frontend" && "$TARGET" != "backend" ]]; then
  echo "Usage: $0 {frontend|backend}" >&2
  exit 2
fi

RG="${RG:-dmatAI}"
ACR_NAME="${ACR_NAME:-dmatchronologyacr}"
ACR_SERVER="${ACR_SERVER:-${ACR_NAME}.azurecr.io}"

if [[ "$TARGET" == "frontend" ]]; then
  APP_NAME="${APP_NAME:-chronologyai-frontend}"
  IMAGE_NAME="${IMAGE_NAME:-chronologyai-frontend}"
  DOCKERFILE="${DOCKERFILE:-frontend/Dockerfile}"
  BUILD_CTX="${BUILD_CTX:-frontend}"
else
  APP_NAME="${APP_NAME:-chronologyai-backend}"
  IMAGE_NAME="${IMAGE_NAME:-chronologyai-backend}"
  DOCKERFILE="${DOCKERFILE:-backend/Dockerfile}"
  BUILD_CTX="${BUILD_CTX:-backend}"
fi

TAG="${TAG:-$(git rev-parse --short HEAD)}"
FULL_IMAGE="${ACR_SERVER}/${IMAGE_NAME}:${TAG}"

echo "[deploy] target=${TARGET} rg=${RG} app=${APP_NAME} image=${FULL_IMAGE}"

# For ChronologyAI, the frontend needs NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL at *build time*,
# because Next.js inlines NEXT_PUBLIC_* into client bundles.
BACKEND_APP_NAME="${BACKEND_APP_NAME:-chronologyai-backend}"
BACKEND_FQDN="${BACKEND_FQDN:-$(az containerapp show -g "${RG}" -n "${BACKEND_APP_NAME}" --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || true)}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-${BACKEND_FQDN:+https://${BACKEND_FQDN}}}"
NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL:-${BACKEND_FQDN}}"

if [[ "$TARGET" == "frontend" ]]; then
  if [[ -z "${NEXT_PUBLIC_API_URL}" || -z "${NEXT_PUBLIC_WS_URL}" ]]; then
    echo "[deploy] error: NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL could not be determined" >&2
    echo "[deploy] hint: set NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL env vars explicitly" >&2
    exit 1
  fi
  echo "[deploy] build args: NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}"
fi

if command -v docker >/dev/null 2>&1; then
  echo "[deploy] az acr login: ${ACR_NAME}"
  az acr login -n "${ACR_NAME}" >/dev/null

  echo "[deploy] docker build"
  if [[ "$TARGET" == "frontend" ]]; then
    docker build -t "${FULL_IMAGE}" -f "${DOCKERFILE}" \
      --build-arg "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}" \
      --build-arg "NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}" \
      "${BUILD_CTX}"
  else
    docker build -t "${FULL_IMAGE}" -f "${DOCKERFILE}" "${BUILD_CTX}"
  fi

  echo "[deploy] docker push"
  docker push "${FULL_IMAGE}"
else
  # Docker-less deploy path: use ACR cloud build (recommended for CI/locked environments).
  echo "[deploy] docker not found; using az acr build (cloud build)"
  if [[ "$TARGET" == "frontend" ]]; then
    echo "[deploy] acr=${ACR_NAME} dockerfile=${DOCKERFILE} context=${BUILD_CTX} tags=${TAG},latest (with build args)"
    az acr build -r "${ACR_NAME}" \
      -f "${DOCKERFILE}" \
      -t "${IMAGE_NAME}:${TAG}" \
      -t "${IMAGE_NAME}:latest" \
      --build-arg "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}" \
      --build-arg "NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}" \
      "${BUILD_CTX}" >/dev/null
  else
    echo "[deploy] acr=${ACR_NAME} dockerfile=${DOCKERFILE} context=${BUILD_CTX} tags=${TAG},latest"
    az acr build -r "${ACR_NAME}" \
      -f "${DOCKERFILE}" \
      -t "${IMAGE_NAME}:${TAG}" \
      -t "${IMAGE_NAME}:latest" \
      "${BUILD_CTX}" >/dev/null
  fi
fi

echo "[deploy] update containerapp image"
az containerapp update -g "${RG}" -n "${APP_NAME}" --image "${FULL_IMAGE}" >/dev/null

echo "[deploy] verify latest ready revision"
az containerapp show -g "${RG}" -n "${APP_NAME}" \
  --query "{app:name,latestReadyRevision:properties.latestReadyRevisionName,latestRevision:properties.latestRevisionName,image:properties.template.containers[0].image}" \
  -o table
