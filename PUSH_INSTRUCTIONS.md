# PUSH INSTRUCTIONS — AgentAudit

## Krok 1 — Stwórz repo na GitHub (żona)

1. github.com/signup → nowe konto
2. Username: agentaudit-lab (lub podobny)
3. "New repository" →
   - Name: AgentAudit
   - Description: Immutable on-chain audit logs for AI agents. EU AI Act compliant.
   - Public ✅
   - NIE dodawaj README (mamy własny)
   - License: MIT
4. "Create repository"

## Krok 2 — Sklonuj i wrzuć pliki

```bash
# Na komputerze — terminal
mkdir AgentAudit && cd AgentAudit
git init
git remote add origin https://github.com/NAZWA_KONTA/AgentAudit.git

# Wrzuć pliki do folderu AgentAudit/:
# - README.md
# - index.html
# - contracts/AuditVault.sol
# - scripts/deploy.ts
# - sdk/src/index.ts
# - sdk/package.json
# - package.json
# - .gitignore

git add .
git commit -m "feat: initial AgentAudit release — AuditVault.sol + TypeScript SDK"
git branch -M main
git push -u origin main
```

## Krok 3 — GitHub Pages (landing page)

Settings → Pages → Source: main branch → / (root) → Save
URL będzie: https://agentaudit-lab.github.io/AgentAudit/

## Krok 4 — Topics (tagi dla grantu)

W repo → górny prawy "gear" przy About:
- ai-agent
- audit-log
- eu-ai-act
- blockchain
- mantle
- web3
- compliance
- typescript
