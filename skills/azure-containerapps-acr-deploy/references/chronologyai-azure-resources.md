## ChronologyAI (dmatAI) Azure resource inventory (2026-01)

- **Resource group**: `dmatAI` (Japan East)
- **ACR**: `dmatchronologyacr` (server: `dmatchronologyacr.azurecr.io`)
- **Container Apps env**: `dmat-containerapp-env`
- **Container Apps**:
  - `chronologyai-frontend`
    - public FQDN: `chronologyai-frontend.blackforest-2ac3dad5.japaneast.azurecontainerapps.io`
    - image: `dmatchronologyacr.azurecr.io/chronologyai-frontend:latest` (often updated to a pinned tag during deploy)
  - `chronologyai-backend`
    - public FQDN: `chronologyai-backend.blackforest-2ac3dad5.japaneast.azurecontainerapps.io`
    - image: `dmatchronologyacr.azurecr.io/chronologyai-backend:latest`

### Quick verify commands

```bash
az resource list -g dmatAI -o table
az containerapp show -g dmatAI -n chronologyai-frontend --query "properties.latestReadyRevisionName" -o tsv
az containerapp show -g dmatAI -n chronologyai-backend --query "properties.latestReadyRevisionName" -o tsv
```
