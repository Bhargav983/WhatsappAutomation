# WA-AKG Deployment Guide: Applying Recent Scheduler & Pilot Upgrades

The following upgrades have been successfully coded into the codebase:
1. **WhatsApp Group Tagging Fix**: Updates to `src/lib/scheduled-mentions.ts` to construct nested `contextInfo.mentionedJid` arrays required by Baileys to trigger active tags, highlights, and group push notifications.
2. **Searchable Contact Scheduler Dropdown**: Implemented searchable comboboxes for personal scheduled messages inside both the creation and edit panels in `src/app/dashboard/scheduler/page.tsx`.
3. **Queue Listing Translation**: Upgraded the queue lists (Pending Queue and History Logs) to translate raw JIDs into legible Group Subjects or Contact Names dynamically.
4. **AI Pilot Name Search Fix**: Resolved the Pilot Contact settings search bug in `src/app/dashboard/ai-chat/page.tsx` by correctly binding the auto-complete dropdown query response key to Next.js API's standard `.data` array envelope instead of `.contacts`.

---

### 🚀 How to Apply These Changes (Next Steps)

To compile and launch the upgraded code on your server, follow these exact steps:

#### Step 1: Kill Stale Hidden Background Servers
Because `Start-WA-AKG.ps1` starts Node in a hidden window, older background processes may lock port `3000` and files. Run this in your PowerShell window to force terminate any running background node instances cleanly:
```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
```

#### Step 2: Re-build the Application
To compile all the frontend components, API hooks, and TypeScript improvements:
```powershell
npm run build
```

#### Step 3: Start WA-AKG
Start the application using your standard launcher script:
```powershell
powershell -ExecutionPolicy Bypass -File .\Start-WA-AKG.ps1
```

Open your browser and navigate to:
- **http://localhost:3000/dashboard/scheduler** (to test the translated names & dropdown)
- **http://localhost:3000/dashboard/ai-chat** (to test Pilot name search under settings)

