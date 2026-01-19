---
name: azure-containerapps-acr-deploy
description: Deploy ChronologyAI (or similar) to Azure Container Apps backed by Azure Container Registry (ACR). Use when you need to build Docker images, push to ACR, update Container App image tags, and verify the rollout (resource group dmatAI; ACR dmatchronologyacr; apps chronologyai-frontend/chronologyai-backend).
---

# Azure Container Apps + ACR deploy (ChronologyAI)

This skill standardizes the deployment workflow for ChronologyAI on Azure Container Apps using ACR.

## Defaults (ChronologyAI in Azure)

- **Resource group**: `dmatAI`
- **ACR**: `dmatchronologyacr` (`dmatchronologyacr.azurecr.io`)
- **Container Apps**:
  - **Frontend**: `chronologyai-frontend` (port 3000)
  - **Backend**: `chronologyai-backend` (port 8000)

## Deploy workflow (recommended)

Run the bundled script from the repo root.

- Deploy frontend:

```bash
bash skills/azure-containerapps-acr-deploy/scripts/deploy_containerapp.sh frontend
```

- Deploy backend:

```bash
bash skills/azure-containerapps-acr-deploy/scripts/deploy_containerapp.sh backend
```

## Notes / pitfalls

- Ensure Azure subscription is correct: `az account show`.
- Ensure you can push to ACR and update Container Apps.
- Avoid dumping secrets (do **not** run `az containerapp show` without `--query` on backend).
