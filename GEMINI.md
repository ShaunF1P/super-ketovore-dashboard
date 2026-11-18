# Super Ketovore Dashboard — Workspace Rules & State Index

## 1. Authoritative Context & State Files
- **Live Coaching State**: `LOCAL_HANDOFF_STATE.md`
- **Daily Execution & Master Clock**: `SHAUN_SUB5_VISCERAL_EXECUTION_PLAN.md`
- **Biometric Laws & Playbook**: `SHAUN_PERSONAL_KETOVORE_PLAYBOOK.md`
- **Master Multi-Creator Blueprint & Catalog**: `SUPER_KETOVORE_LIFESTYLE_AND_WORKOUT_PROGRAM.md`, `CREATOR_VIDEO_LIBRARY_CATALOG.md`, `PROJECT.md`

## 2. Dashboard Sync & Deployment Rules
- **Live URL**: `https://shaunf1p.github.io/super-ketovore-dashboard/`
- **Dual-File Mirror Requirement**: `index.html` is the primary production file; always mirror updates to `super_ketovore_dashboard.html` so both stay in sync.
- **Git Rebase Before Push**: `.github/workflows/sync_creator_videos.yml` runs automatically every Wednesday and Sunday at `08:00 AM EST` and commits to `creator_radar_feed.json`. Always run `git pull --rebase origin main` before `git push`.
- **UI Icon Constraint**: Never introduce emojis in new UI elements, headings, or text copy; use inline SVGs / Lucide icons only.

## 3. Live Biometric Auto-Ingest (`ghealth` + Android Health Connect)
- **Daily Sync Script**: Run `node sync_health_daily.mjs` (or `npm run sync:health`, writes `health_connect_live_sync.json`) at the start of morning check-ins to pull verified `Fitbit Air` + `Health Connect` telemetry automatically via `C:\Users\shaun\.gemini\antigravity\bin\ghealth.exe` (`shaun-health-app`, `America/New_York`).
- **Wearable Hardware**: `Fitbit Air` (`deviceType: TRACKER`, `FITNESS_BAND`) — provides live Sleep stages (`DEEP`, `REM`, `LIGHT`, `AWAKE`), RHR, HRV (`average` + `deepSleepRMSSD` + `nonRemHR`), SpO2, Respiratory Rate, Skin Temp, Steps (`daily-rollup`), Total Burned Calories (`daily-rollup`), and Exercise sessions.
- **Health Connect Bridged Apps (`platform: HEALTH_CONNECT` -> Fitbit Cloud -> `ghealth`)**:
  - `com.mymojohealth.app` (`Keto-Mojo`): Capillary `blood-glucose` (`mg/dL`) syncs automatically (`blood_ketones` is not in the Health Connect schema; prompt user only for ketone `mmol/L` if needed).
  - `MorphoScan` (`Fitdays` 8-electrode scale): Syncs `weight` and `body-fat` when `MorphoScan -> Health Connect / Fitbit` write and `Fitbit -> Health Connect` read permissions are active (raw `20kHz/100kHz` segmental `Z(Ohms)` and `Visceral Fat Grade` require the `MorphoScan` report image).

## 4. Non-Negotiable Coaching & Injury Guardrails
- **Right Bicep Tendon (`Jul 10, 2025` unrepaired)**: Zero supinated/underhand heavy pulling or curling. Strictly Neutral Parallel Grip on rows/pulldowns/curls/thrusters and Double-Overhand Pronated + Lifting Straps on deadlifts/RDLs. Include Keith Baar `4 x 30s` `90-degree` neutral isometric cable holds + `18g` Collagen + `500mg` Vitamin C `45m` pre-lift.
- **Right Acromion (`Mar 13, 2025`)**: Use `OxeFit Chains` mode on presses; rack overhead sets if mean concentric velocity drops `< 0.50 m/s`.
- **Circadian & Session Guardrails**: Hard `50-minute` workout cap (`COMT GG`), caffeine strictly `<= 1:00–1:30 PM` (even with `CYP1A2 AA`, `6:00 PM` Cafe Mocha clipped sleep to `<5h` on `Nov 16`), target `5:30 PM` kitchen lockout (`MTNR1B CG`; `7:00 PM` work buffer, never past `7:30 PM`).
