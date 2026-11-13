#!/usr/bin/env python3
"""
Super Ketovore v5.0 — Automated 14-Creator Video Radar, Sobriety/Mindset & Cloud Sync Engine
=============================================================================================
Polls YouTube Atom/RSS feeds (with automatic @Handle -> UC channel_id resolution) for Shaun's
14 Tier-1 Health, Hypertrophy, Metabolic, Longevity, Mindset & Natural Sobriety Creators
(Original 5 + The Diary Of A CEO + 7 Specialized Clinical Authorities + @SoberFitness),
filters against Shaun's biomarker/protocol keywords, merges with curated protocol takeaways,
updates creator_radar_feed.json, and optionally downloads English transcripts via yt-dlp.

Cloud Automation:
  Runs automatically every Wednesday & Sunday @ 08:00 AM EST (13:00 UTC) via GitHub Actions
  (.github/workflows/sync_creator_videos.yml) and commits updates to creator_radar_feed.json.

Usage:
  python3 sync_creator_videos.py --check          # Poll feeds & update creator_radar_feed.json
  python3 sync_creator_videos.py --download-new   # Download newly detected transcripts via yt-dlp
  python3 sync_creator_videos.py --roster         # Print the 14-Creator Roster & Sync Cadence
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import urllib.request
import xml.etree.ElementTree as ET
from typing import Dict, List, Any

FEED_OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creator_radar_feed.json")
DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creator_downloads")

# ============================================================================
# 14-CREATOR ROSTER: ORIGINAL 5 + DOAC + 7 CLINICAL AUTHORITIES + SOBER FITNESS
# ============================================================================
CREATOR_ROSTER: List[Dict[str, Any]] = [
    # --- ORIGINAL 5 CORE CREATORS ---
    {
        "id": "jeremy_ethier",
        "name": "Jeremy Ethier",
        "handle": "@JeremyEthier",
        "channel_id": "UCERm5yFZ1SptUEU4wZ2vJvw",
        "subscribers": "8.0M",
        "tier": "Original Core 5",
        "domain": "EMG Biomechanics, Minimum Effective Volume & Tendon-Safe Exercise Selection",
        "shaun_genotype_link": "ACTN3 CC (Power/Sprint) + COL1A1 AC / MMP3 CT (Right Bicep Tendon Protection)",
        "cadence": "Tier B — Weekly Sunday 08:00 AM EST Sync",
        "priority_keywords": ["workout", "split", "time", "ab", "bicep", "shoulder", "volume", "stretch", "fat", "steps"],
        "latest_verified_drops": [
            {
                "date": "2026-11-09",
                "video_id": "je_nov09_2026",
                "title": "It's Tough, But Burns Fat 4x Faster Than 10K Steps/Day (21:56)",
                "views": "3.2M (4 days ago!)",
                "protocol_takeaway": "Time-efficient interval conditioning burst protocol that amplifies post-exercise fat oxidation 4x per minute when short on step time—pairs with Crossrope / FightCamp finishers."
            },
            {
                "date": "2026-11-01",
                "video_id": "new_nov1_2026",
                "title": "I Gave Him Fake Steroids For 100 Days",
                "views": "4.1M",
                "protocol_takeaway": "Demonstrates expectation/placebo effect vs. natural training ceiling when recovery and progressive overload are locked in."
            },
            {
                "date": "2026-10-11",
                "video_id": "wI2WVevL_lk",
                "title": "Why (Almost) Everyone Is Wasting Their Time In The Gym (200-Lifter 3-Day vs. 6-Day Study)",
                "views": "4.9M",
                "protocol_takeaway": "10-week study of 200+ lifters proving 3–4 focused sessions/wk beat 6-day high-volume splits due to recovery debt and systemic fatigue—directly validating your 45-min 4–5x/wk OxeFit cap."
            },
            {
                "date": "2026-09-27",
                "video_id": "0ShG8aVIvms",
                "title": "It's Weird, But Destroyed Every Ab Exercise I Tested",
                "views": "2.1M",
                "protocol_takeaway": "Ranks Face-Away Lat Pulldown Cable Crunch #1 for upper abs and Garhammer Raises / AdMat Reverse Crunches #1 for lower abs with zero spinal/bicep strain."
            }
        ]
    },
    {
        "id": "dr_boz",
        "name": "Dr. Annette Bosworth (Dr. Boz, MD)",
        "handle": "@DoctorBoz",
        "channel_id": "UCLGu62anfPbFDkdQj0p-hQw",
        "subscribers": "1.3M",
        "tier": "Original Core 5",
        "domain": "72h–7d Sardine Fasting, Dr. Boz Ratio (GKI), Autophagy & Deep Ketogenesis",
        "shaun_genotype_link": "TCF7L2 CT + MTNR1B CG (AM Ketone PR 2.0 mmol/L & AM DBR 45.0!)",
        "cadence": "Tier A — Every Wednesday & Sunday @ 08:00 AM EST",
        "priority_keywords": ["sardine", "ketone", "ketosis", "fasting", "autophagy", "insulin", "mct", "carnivore"],
        "latest_verified_drops": [
            {
                "date": "2026-11-06",
                "video_id": "substack_nov6_2026",
                "title": "She Lost Seven Pounds on Sardines. That Wasn't the Point. + 'What's Wrong With Healthy Diet Advice' (52:30)",
                "views": "Substack + Live Stream",
                "protocol_takeaway": "Separates the rapid first-week glycogen/fluid drop (your 209.6 -> 200.0 lb -9.6 lb 5-day plunge!) from the true metabolic prize: crashing basal insulin and hitting 2.0+ mmol/L morning BHB."
            },
            {
                "date": "2026-10-13",
                "video_id": "YSlr0ntjQzU",
                "title": "100 Cans of Sardines and No Ketones. Now What?",
                "views": "101K (1:00:31 Live Q&A)",
                "protocol_takeaway": "Explains why late-night eating, poor sleep (cortisol spikes), or hidden sauces block ketosis—reinforcing your 5:30 PM cutoff + 3 tbsp C8/C10 MCT oil protocol."
            },
            {
                "date": "2026-10-04",
                "video_id": "XsAUZQugviY",
                "title": "Boz 2 Ketones",
                "views": "54K",
                "protocol_takeaway": "Clinical troubleshooting for transitioning from exogenous C8/C10 support to endogenous 2.0–4.0 mmol/L blood BHB."
            }
        ]
    },
    {
        "id": "jeff_nippard",
        "name": "Jeff Nippard",
        "handle": "@JeffNippard",
        "channel_id": "UC68TLK0mAEzUyHx5x5k-S1Q",
        "subscribers": "8.77M",
        "tier": "Original Core 5",
        "domain": "Lengthened Partials, Body Recomposition Macros & Evidence-Based Hypertrophy",
        "shaun_genotype_link": "FFM Preservation (148.2–151.0 lb -> 164.5 lb Target during Aggressive Cut)",
        "cadence": "Tier B — Weekly Sunday 08:00 AM EST Sync",
        "priority_keywords": ["hypertrophy", "recomp", "calories", "peptide", "protein", "volume", "stretch", "muscle"],
        "latest_verified_drops": [
            {
                "date": "2026-10-28",
                "video_id": "jn_oct28_2026",
                "title": "How Many Energy Drinks Can You Have Before It's A Problem?",
                "views": "5.29M",
                "protocol_takeaway": "Sets hard cardiovascular and adenosine-recovery ceilings on daily caffeine (critical for CYP1A2 AC intermediate metabolizers: cut off by 12:00 PM)."
            },
            {
                "date": "2026-10-17",
                "video_id": "jn_oct17_2026",
                "title": "What Do 100 Calories Actually Look Like?",
                "views": "4.10M",
                "protocol_takeaway": "Visualizes caloric density vs. satiety volume—explaining why whole-food protein/sardines/turkey sausage/guac lock in satiety at 1,150–1,450 kcal."
            },
            {
                "date": "2026-10-08",
                "video_id": "jn_oct08_2026",
                "title": "The Best & Worst Peptides (Ranked) / Peptides Are Insane (Sep 28 Long-Form)",
                "views": "3.42M (Short) / 19.17M (Long-Form)",
                "protocol_takeaway": "Evidence audit of BPC-157, TB-500, and GH secretagogues for tendon recovery vs. natural mechanical loading + collagen."
            }
        ]
    },
    {
        "id": "ryan_humiston",
        "name": "Ryan Humiston",
        "handle": "@RyanHumiston",
        "channel_id": "UCj209lI3ZOmOCkK8e3qFFNQ",
        "subscribers": "2.26M",
        "tier": "Original Core 5",
        "domain": "High-Tension Mechanical Isolation, Joint-Friendly Angles & Supplement Audits",
        "shaun_genotype_link": "Right Bicep/Shoulder Protection via Constant-Tension Cable/OxeFit Curves",
        "cadence": "Tier C — Bi-Weekly Sunday Sync",
        "priority_keywords": ["bicep", "shoulder", "scam", "supplement", "hypertrophy", "cable", "isolation"],
        "latest_verified_drops": [
            {
                "date": "2026-10-13",
                "video_id": "jRbj25q-AjU",
                "title": "Exposing The Biggest Scam In Supplements",
                "views": "612.6K",
                "protocol_takeaway": "Cuts through proprietary under-dosed blends in favor of single-ingredient clinical staples (Creatine 5g, Pure C8/C10 MCT, Hydrolyzed Collagen, EPA/DHA, Magnesium)."
            }
        ]
    },
    {
        "id": "bryan_johnson",
        "name": "Bryan Johnson (Blueprint)",
        "handle": "@BryanJohnson",
        "channel_id": "UCnRVL1-HJnXWB_Xi2dAoTcg",
        "subscribers": "2.26M",
        "tier": "Original Core 5",
        "domain": "Circadian Cutoff, Sleep Architecture, Biological Age & Biomarker Tracking",
        "shaun_genotype_link": "MTNR1B CG (Early Dinner Cutoff) + COMT GG (Evening Parasympathetic Downregulation)",
        "cadence": "Tier C — Bi-Weekly Sunday Sync",
        "priority_keywords": ["sleep", "hrv", "resting heart rate", "biomarker", "longevity", "fasting", "microplastics"],
        "latest_verified_drops": [
            {
                "date": "2026-11-07",
                "video_id": "bj_nov07_2026",
                "title": "Am I a Billionaire? I Answer the Internet's Questions + Blueprint Biomarker Q&A",
                "views": "494K (6 days ago!)",
                "protocol_takeaway": "Reiterates autonomous evening wind-down, strict early meal cutoff (4+ hours pre-bed), and objective blood/wearable tracking over guesswork."
            },
            {
                "date": "2026-10-20",
                "video_id": "bj_oct2026",
                "title": "Blueprint 2026 Sleep & Early-Cutoff Metabolic Protocol",
                "views": "1.3M",
                "protocol_takeaway": "Confirms that finishing caloric intake 4+ hours before sleep drops nocturnal RHR by 4–6 bpm and prevents overnight glucose elevation."
            }
        ]
    },

    # --- CREATOR #6: THE DIARY OF A CEO (HEALTH, METABOLIC & MINDSET HUB) ---
    {
        "id": "diary_of_a_ceo",
        "name": "Steven Bartlett — The Diary Of A CEO",
        "handle": "@TheDiaryOfACEO",
        "channel_id": "UCGq-a57w-aPwyi3pW7XLiHw",
        "subscribers": "21.9M (2.05B+ Views)",
        "tier": "Expanded Authority #6 (Health, Metabolic & Mindset Masterclasses)",
        "domain": "World-Class Doctor Roundtable Interviews, Liver/Visceral Fat Reversal, Dopamine/Stress Control & Identity Mindset",
        "shaun_genotype_link": "COMT GG + BDNF CT (Stress/Dopamine Binge Prevention) + PEMT CT (ALT 48 Fatty Liver Drain) + FTO AT (Identity Habits)",
        "cadence": "Tier A — Every Thursday & Sunday @ 08:00 AM EST",
        "priority_keywords": ["insulin", "fasting", "keto", "ketone", "visceral", "liver", "sugar", "brain", "dementia", "dopamine", "stress", "habit"],
        "latest_verified_drops": [
            {
                "date": "2026-11-12",
                "video_id": "doac_nov12_2026",
                "title": "The Brain Doctor Who Explains The Main Cause Of Dementia - Dr. David Perlmutter (1:55:46)",
                "views": "949K (22 hours ago!)",
                "protocol_takeaway": "Connects insulin resistance, elevated uric acid, and cerebral glucose hypometabolism directly to cognitive decline—proving your 2.0 mmol/L blood BHB ketones protect and super-fuel brain mitochondria."
            },
            {
                "date": "2026-10-12",
                "video_id": "Zqrn4XwscY8",
                "title": "The Most Valuable 40 Minutes You'll Spend This Year (High-Performance Mindset & Control)",
                "views": "4.8M",
                "protocol_takeaway": "Reframes success from external/scale outcomes to controllable daily execution inputs—eliminating the 'weekend reward binge' trap after hitting 200.0 lb."
            },
            {
                "date": "2026-01-08",
                "video_id": "C7LL7VwP8Nc",
                "title": "Insulin Expert (Dr. Ben Bikman): How To 'Drain' Your Liver of Fat (Do This!) + Ketone Meter Live Test",
                "views": "6.4M",
                "protocol_takeaway": "Steven pricks his finger daily for blood BHB on camera while Dr. Bikman explains how crashing insulin via ketosis reverses de novo lipogenesis and drains liver fat (ALT 48 -> <25)."
            }
        ]
    },

    # --- EXPANDED 7 TIER-1 LONGEVITY, METABOLIC & TENDON AUTHORITIES (#7 TO #13) ---
    {
        "id": "peter_attia",
        "name": "Dr. Peter Attia, MD (The Drive)",
        "handle": "@PeterAttiaMD",
        "channel_id": "UC8kGsMa0LygSX9nkBcBH1Sg",
        "subscribers": "1.04M",
        "tier": "Expanded Authority #7",
        "domain": "ApoB / Small LDL Particle Clearance, Zone 2 Mitochondrial Base, VO2 Max & Aging Strength",
        "shaun_genotype_link": "APOA2 CC + CETP AA (ApoB 96, Small LDL 389 nmol/L) + COL1A1 AC Age-39 Tendon-Safe RIR",
        "cadence": "Tier B — Weekly Sunday 08:00 AM EST Sync",
        "priority_keywords": ["apob", "ldl", "zone 2", "vo2 max", "insulin", "strength", "resistance", "reserve", "lipid"],
        "latest_verified_drops": [
            {
                "date": "2026-11-12",
                "video_id": "pa_nov12_2026",
                "title": "Understanding reps in reserve | Jeff Cavaliere (3:28)",
                "views": "New (1 day ago!)",
                "protocol_takeaway": "Calibrates true 1–2 RIR on heavy compounds vs. safe failure on cables so your OxeFit Day 1 stimulus builds muscle without stressing your right bicep scar."
            },
            {
                "date": "2026-11-10",
                "video_id": "pa_414_nov10_2026",
                "title": "#414 ‒ Resistance training as we age: exercise selection, training intensity, and much more (2:45:31)",
                "views": "53K (3 days ago!)",
                "protocol_takeaway": "Age-39+ blueprint for joint-friendly exercise selection, eccentric control, and preserving fast-twitch power (your 1,437 W ACTN3 CC engine) for decades."
            },
            {
                "date": "2026-10-26",
                "video_id": "pa_oct2026",
                "title": "Lipid Management, ApoB Targets & Why Saturated Fat Tolerance Varies by Genotype",
                "views": "340K",
                "protocol_takeaway": "Explains why APOA2 CC carriers spike Small LDL on butter/tallow overload and thrive when swapping to sardines, avocado guac, and EVOO."
            }
        ]
    },
    {
        "id": "andrew_huberman",
        "name": "Dr. Andrew Huberman, PhD (Huberman Lab)",
        "handle": "@hubermanlab",
        "channel_id": "UC2D2CMWXMOVWx7giW1n3LIg",
        "subscribers": "8.02M",
        "tier": "Expanded Authority #8",
        "domain": "COMT GG Dopamine/Addiction Circuitry, Cortisol Regulation, Heat/Cold & Circadian Light",
        "shaun_genotype_link": "COMT GG (Warrior Fast Dopamine Clearance) + BDNF CT + MTNR1B CG",
        "cadence": "Tier B — Weekly Sunday 08:00 AM EST Sync",
        "priority_keywords": ["cortisol", "dopamine", "addiction", "cold", "heat", "sleep", "recovery", "sodium"],
        "latest_verified_drops": [
            {
                "date": "2026-11-10",
                "video_id": "ah_nov10_2026",
                "title": "Overcome Addictions and Obsessions of All Kinds | Dr. Anna Lembke (2:16:51)",
                "views": "378K (3 days ago!)",
                "protocol_takeaway": "Dissects the dopamine pleasure-pain seesaw behind weekend food/alcohol reward loops—directly reinforcing your COMT GG + @SoberFitness 90-Day Dopamine Reset."
            },
            {
                "date": "2026-11-06",
                "video_id": "ah_nov06_2026",
                "title": "Essentials: Cold & Heat Exposure for Metabolic Health | Dr. Susanna Søberg (38:22)",
                "views": "109K (7 days ago!)",
                "protocol_takeaway": "Establishes the minimum effective dose (57 min/wk sauna + 11 min/wk cold) to activate brown fat uncoupling and boost insulin sensitivity."
            },
            {
                "date": "2026-10-19",
                "video_id": "ah_oct2026",
                "title": "Controlling Cortisol, Autonomic Arousal & Recovery After High-Output Training",
                "views": "480K",
                "protocol_takeaway": "Validates the 5-minute post-OxeFit physiological sigh (double inhale + long exhale) to halt sympathetic hepatic glucose dumping."
            }
        ]
    },
    {
        "id": "rhonda_patrick",
        "name": "Dr. Rhonda Patrick, PhD (FoundMyFitness)",
        "handle": "@FoundMyFitness",
        "channel_id": "UCWF8SqJVNlx-ctXbLswcTcA",
        "subscribers": "737K",
        "tier": "Expanded Authority #9",
        "domain": "Saturated Fat vs. Red Meat/Seed Oils, Omega-3 Index (FADS1 TT) & Marine Phospholipids",
        "shaun_genotype_link": "FADS1 TT (OmegaCheck 5.3%) + APOA2 CC (ApoB 96) + PEMT CT (ALT 48 Choline)",
        "cadence": "Tier C — Bi-Weekly Sunday Sync",
        "priority_keywords": ["saturated fat", "red meat", "seed oil", "omega-3", "fads1", "protein", "dietary fat"],
        "latest_verified_drops": [
            {
                "date": "2026-11-13",
                "video_id": "rp_nov13_2026",
                "title": "The Hype vs. Data on Saturated Fat, Red Meat, & Seed Oils (2:37:03)",
                "views": "BRAND NEW (2 hours ago!)",
                "protocol_takeaway": "Separates whole unprocessed red meat (creatine/carnitine/taurine/betaine) from refined butter/dairy saturated fat excess and oxidized seed oils—100% validating your Steak/Brisket + Sardines + Avocado Guac + C8 MCT blueprint for ApoB <70!"
            },
            {
                "date": "2026-10-15",
                "video_id": "rp_oct15_2026",
                "title": "Dr. Dariush Mozaffarian: Dietary Fats, Ultra-Processed Foods & Food as Medicine",
                "views": "215K",
                "protocol_takeaway": "Reinforces whole-food marine fats and food-matrix effects on cardiometabolic health over isolated refined fats."
            },
            {
                "date": "2026-08-19",
                "video_id": "rp_aug19_2026",
                "title": "What the Omega-3 Index Reveals About Heart Health (Why <6% Accelerates Risk)",
                "views": "310K",
                "protocol_takeaway": "Your Quest OmegaCheck is 5.3% (FADS1 TT). Eating sardines + 3–4g/day EPA/DHA moves your Omega-3 Index into the optimal >8.0% zone."
            }
        ]
    },
    {
        "id": "ben_bikman",
        "name": "Dr. Ben Bikman, PhD (The Metabolic Classroom)",
        "handle": "@benbikman",
        "channel_id": "",
        "subscribers": "233K",
        "tier": "Expanded Authority #10",
        "domain": "Insulin-to-Glucagon Ratio, Potassium/Blood Sugar Link, Asprosin & Ketogenic Uncoupling",
        "shaun_genotype_link": "TCF7L2 CT + FTO AT (2.0 mmol/L BHB PR, Potassium/Sodium Pump & Asprosin Suppression)",
        "cadence": "Tier A — Every Wednesday & Sunday @ 08:00 AM EST",
        "priority_keywords": ["insulin", "glucagon", "ketone", "potassium", "asprosin", "glp-1", "protein", "fasting"],
        "latest_verified_drops": [
            {
                "date": "2026-11-02",
                "video_id": "AZtu3RSXbiE",
                "title": "Ep 169: How Your Body Fat Can Make You Hungrier (Asprosin & Hepatic Glucose Dumping)",
                "views": "98K",
                "protocol_takeaway": "Explains how fat cells secrete Asprosin after carb binges to trigger hunger and morning liver glucose—and how hitting 2.0+ mmol/L ketosis shuts Asprosin off."
            },
            {
                "date": "2026-10-26",
                "video_id": "bb_ep168_2026",
                "title": "Ep 168: Why What You Eat Still Matters on GLP-1 Drugs (Lean Mass Preservation)",
                "views": "74K",
                "protocol_takeaway": "Demonstrates why protein sufficiency + resistance tension are non-negotiable during rapid appetite-suppressed weight loss so FFM stays locked."
            },
            {
                "date": "2026-10-19",
                "video_id": "bb_ep167_2026",
                "title": "Ep 167: Could Low Potassium Be Raising Your Blood Sugar? (29:29)",
                "views": "90K",
                "protocol_takeaway": "Directly proves our bodybuilder electrolyte rule: low potassium impairs insulin sensitivity and raises fasting glucose—validating your 6 tbsp Avocado Guac (~540 mg K+) + meat/sardines alongside 4,500–5,500 mg sodium!"
            }
        ]
    },
    {
        "id": "thomas_delauer",
        "name": "Thomas DeLauer",
        "handle": "@ThomasDeLauerOfficial",
        "channel_id": "UC70srI3VkT1MXALRtf0pcHg",
        "subscribers": "4.05M",
        "tier": "Expanded Authority #11",
        "domain": "Applied Sardine Fast Variations, C8/C10 MCT Timing, Oral hs-CRP & 2026 Ketovore Protein",
        "shaun_genotype_link": "Practical Sardine/MCT Execution + hs-CRP (1.5 -> <0.5) + Lean FFM Protein Floor",
        "cadence": "Tier A — Every Wednesday & Sunday @ 08:00 AM EST",
        "priority_keywords": ["sardine", "keto", "mct", "fast", "insulin", "protein", "shredded", "gum", "carnivore"],
        "latest_verified_drops": [
            {
                "date": "2026-11-13",
                "video_id": "td_nov13_2026",
                "title": "This is Worse than Diet and Lack of Exercise for Insulin Resistance (12:41)",
                "views": "15K (5 hours ago!)",
                "protocol_takeaway": "Highlights sleep fragmentation, circadian misalignment (eating late with MTNR1B CG), and chronic sympathetic stress as primary drivers of morning Dawn Phenomenon glucose."
            },
            {
                "date": "2026-11-12",
                "video_id": "td_nov12_2026",
                "title": "The Exact Protein Amount Needed to Build Muscle has Finally Been Discovered (11:31)",
                "views": "87K (1 day ago!)",
                "protocol_takeaway": "Confirms scaling protein to fat-free mass (~0.85–1.1g/lb FFM = 130–165g floor on steep 1,200 kcal cut days; 185–205g on OxeFit refuel days) maximizes MPS without excess gluconeogenesis."
            },
            {
                "date": "2026-11-10",
                "video_id": "td_nov10_2026",
                "title": "This Natural Mouth Rinse Kills Gum Bacteria and Reverses Plaque (not baking soda) (7:18)",
                "views": "76K (3 days ago!)",
                "protocol_takeaway": "Protects oral nitrate-reducing bacteria (preserving vascular Nitric Oxide!) while eliminating gingival inflammation that elevates systemic hs-CRP (1.5 mg/L)."
            },
            {
                "date": "2026-11-08",
                "video_id": "td_nov08_2026",
                "title": "The New Driver of Insulin Resistance Starts in Your Fat Cells (10:46) + Nov 5 'Most Shredded I've Ever Been' (15:01)",
                "views": "71K / 79K",
                "protocol_takeaway": "Shows shrinking hypertrophic visceral fat cells (VF 10 -> 9 -> <5) restores adiponectin, while warning against staying sub-8% stage-depleted year-round to protect Free T (114.5 pg/mL)."
            }
        ]
    },
    {
        "id": "mike_israetel",
        "name": "Dr. Mike Israetel, PhD (Renaissance Periodization)",
        "handle": "@RenaissancePeriodization",
        "channel_id": "UCfQgsKhHjSyRLOp9mnffqVg",
        "subscribers": "3.9M",
        "tier": "Expanded Authority #12",
        "domain": "Minimum Effective Volume (MEV), Evidence-Based Supplements & Deficit Hypertrophy",
        "shaun_genotype_link": "Deficit Volume Calibration (6–8 Hard Sets/Muscle/Wk + >=1.0 m/s ACTN3 CC Velocity)",
        "cadence": "Tier C — Bi-Weekly Sunday Sync",
        "priority_keywords": ["volume", "deficit", "fat loss", "supplement", "protein", "studied", "train", "hypertrophy"],
        "latest_verified_drops": [
            {
                "date": "2026-11-12",
                "video_id": "rp_prot_nov12_2026",
                "title": "The Truth About Why Protein Costs So Much Now",
                "views": "190K (1 day ago!)",
                "protocol_takeaway": "Breaks down whey/dairy commodity inflation—proving whole-food sardines, eggs, brisket, and turkey sausage deliver superior micronutrient ROI per gram of bioavailable protein."
            },
            {
                "date": "2026-11-10",
                "video_id": "rp_supp_nov10_2026",
                "title": "Which Supplements Are Actually Legit? (Scientifically Proven) (13:40)",
                "views": "186K (3 days ago!)",
                "protocol_takeaway": "Tier-1 clinical greenlight for Creatine Monohydrate (5g/d), Pre-12PM Caffeine, Marine Omega-3s, and targeted Protein/Collagen—zero wasted money on proprietary fat burners."
            },
            {
                "date": "2026-11-05",
                "video_id": "rp_30k_nov05_2026",
                "title": "30,000 People Studied. This Is How You Should Train. (26:04)",
                "views": "736K (8 days ago!)",
                "protocol_takeaway": "Massive 30,000-trainee longitudinal dataset confirming consistent progressive tension at high proximity to failure (3–5x/wk, <50 min) drives virtually all natural strength & muscle gains."
            }
        ]
    },
    {
        "id": "keith_baar",
        "name": "Dr. Keith Baar, PhD (UC Davis Tendon Lab)",
        "handle": "@KeithBaarLab",
        "channel_id": "",
        "subscribers": "Academic / Podcast Features",
        "tier": "Expanded Authority #13",
        "domain": "Isometric Tendon Creep Loading, Collagen Synthesis & Scar Remodeling",
        "shaun_genotype_link": "COL1A1 AC + MMP3 CT (Jul 10, 2025 Right Bicep Distal Tendon & Mar 13, 2025 Shoulder)",
        "cadence": "Tier C — Monthly Research Digest",
        "priority_keywords": ["tendon", "isometric", "collagen", "bicep", "shoulder", "scar", "extracellular matrix"],
        "latest_verified_drops": [
            {
                "date": "2026-09-10",
                "video_id": "kb_sep2026",
                "title": "Overcoming Tendon Shielding: 30-Second Isometric Holds + Vitamin C-Enriched Collagen",
                "views": "95K",
                "protocol_takeaway": "Heavy slow isometrics (4 x 30s at ~70% MVC) 45 minutes after 15–18g hydrolyzed collagen + 50mg Vitamin C forces aligned collagen fibrils through central tendon scars."
            }
        ]
    },

    # --- CREATOR #14: JACK WILTSHIRE — SOBER FITNESS (@SOBERFITNESS) ---
    {
        "id": "sober_fitness",
        "name": "Jack Wiltshire — Sober Fitness",
        "handle": "@SoberFitness",
        "channel_id": "",
        "subscribers": "246K (3,500 Videos)",
        "tier": "Added Authority #14 (100% Natural Minimalist Lifting, Fitness Dailies & Sobriety Mindset)",
        "domain": "7-Exercise Motor-Skill Mastery, Daily Bodyweight 'Fitness Dailies', 100-Rep Tendon Feeders & 90-Day Dopamine Detox",
        "shaun_genotype_link": "Rack Pro Daily Dips/Leg Raises (GLUT4 2.0 mmol/L BHB Engine!) + COMT GG / FTO AT Sobriety Identity + ALT 48 Alcohol-Free Liver Shield",
        "cadence": "Tier A — Every Wednesday & Sunday @ 08:00 AM EST (3,500-Video High-Frequency Catalog)",
        "priority_keywords": ["exercises", "daily", "dailies", "dips", "leg raises", "pull-ups", "reps", "sober", "dopamine", "willpower", "ginger"],
        "latest_verified_drops": [
            {
                "date": "2026-11-09",
                "video_id": "sf_nov09_2026",
                "title": "Train Your Whole Body With Fewer Exercises (6:44) + Jul 2 'Why I Only Focus on 7 Exercises' (sGBRmRmX9MQ)",
                "views": "190K (4d ago!) / 341K",
                "protocol_takeaway": "Treats 7 compound patterns (Press/Weighted Dip, Row, Squat, OHP, Neutral/Wide Pull-Up, RDL, Core) as lifelong motor skills—eliminating OxeFit exercise-hopping and joint wear."
            },
            {
                "date": "2026-11-02",
                "video_id": "O-3gD2OnAf0",
                "title": "THE KEY TO SERIOUS GAINS (Nov 2) + 'From ER to Squat PR' (Nov 1)",
                "views": "19K+ (Nov 2026)",
                "protocol_takeaway": "Unbroken 90-day consistency and methodical post-injury rebuilding beat ego lifting—mirroring your disciplined right-bicep comeback and OxeFit Day 1 relaunch."
            },
            {
                "date": "2026-09-04",
                "video_id": "_ZyVbh4gUsA",
                "title": "Why Do More Reps (_ZyVbh4gUsA) + 'Develop Your Physique One Aspect at a Time' (S0Z_FxFuz20, Sep 9)",
                "views": "74K / 157K Series",
                "protocol_takeaway": "Occasional 50–100 rep ultra-light feeder sets flush COL1A1 AC tendons with blood and lock in lat/pec mind-muscle connection while specializing on 1 priority goal per 90-day season."
            },
            {
                "date": "2026-08-17",
                "video_id": "aFJT2ssWvWk",
                "title": "How to be about it (aFJT2ssWvWk) + The 90-Day Dopamine Detox & Steroid/TRT Natural Response (8WFkHwb_SIo)",
                "views": "Verified Flagships",
                "protocol_takeaway": "100% lifetime natural & sober identity: eliminates weekend alcohol/binge dopamine crashes, protecting ALT (48 -> <25), Free T (114.5 pg/mL), Oura REM sleep, and unbroken ketosis."
            },
            {
                "date": "2026-08-05",
                "video_id": "g8f8qu2U5II",
                "title": "10 Minute Daily Leg Raises (g8f8qu2U5II) + MY TOP 5 FITNESS DAILIES (zns6VDqfuOU) + Ginger Tea Remedy (vQlvXMDBU-M)",
                "views": "Flagship Dailies",
                "protocol_takeaway": "Exact match for your Rack Pro 50 Dips + 50 Leg Raises evening habit (zero CNS burnout + non-insulin GLUT4 glucose sink -> 2.0 mmol/L BHB PR!) + zero-carb Ginger Tea for MCT digestion & hs-CRP."
            }
        ]
    }
]


def resolve_channel_id(creator: Dict[str, Any]) -> str:
    """Returns channel_id if present, or resolves UC... ID from https://www.youtube.com/@Handle when online."""
    cid = creator.get("channel_id", "")
    if cid.startswith("UC") and len(cid) >= 20:
        return cid
    handle = creator.get("handle", "").strip()
    if not handle.startswith("@"):
        return ""
    url = f"https://www.youtube.com/{handle}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (SuperKetovoreRadar/5.0)"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        match = re.search(r'"externalId":"(UC[a-zA-Z0-9_-]{20,})"', html) or re.search(
            r'channel_id=(UC[a-zA-Z0-9_-]{20,})', html
        )
        if match:
            return match.group(1)
    except Exception:
        pass
    return ""


def fetch_rss_for_creator(creator: Dict[str, Any], max_items: int = 5) -> List[Dict[str, str]]:
    """Polls official YouTube Atom XML feed (when online/GitHub Actions) and merges with verified drops."""
    verified = list(creator.get("latest_verified_drops", []))
    channel_id = resolve_channel_id(creator)
    if not channel_id:
        return verified

    rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    try:
        req = urllib.request.Request(rss_url, headers={"User-Agent": "Mozilla/5.0 (SuperKetovoreRadar/5.0)"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_bytes = resp.read()
        root = ET.fromstring(xml_bytes)
        ns = {
            "atom": "http://www.w3.org/2005/Atom",
            "yt": "http://www.youtube.com/xml/schemas/2015",
            "media": "http://search.yahoo.com/mrss/",
        }
        live_entries: List[Dict[str, Any]] = []
        known_ids = {d.get("video_id") for d in verified}
        known_titles = {d.get("title", "").lower()[:32] for d in verified}

        for entry in root.findall("atom:entry", ns)[:max_items]:
            vid_el = entry.find("yt:videoId", ns)
            title_el = entry.find("atom:title", ns)
            pub_el = entry.find("atom:published", ns)
            stats_el = entry.find(".//media:statistics", ns)

            vid_id = vid_el.text if vid_el is not None else ""
            title = title_el.text if title_el is not None else ""
            published = (pub_el.text or "")[:10] if pub_el is not None else ""
            views_raw = stats_el.attrib.get("views", "") if stats_el is not None else ""
            views_fmt = f"{int(views_raw):,} views (Live RSS)" if views_raw.isdigit() else "Live RSS"

            if vid_id in known_ids or title.lower()[:32] in known_titles:
                continue

            kw_hits = [kw for kw in creator.get("priority_keywords", []) if kw.lower() in title.lower()]
            live_entries.append({
                "date": published,
                "video_id": vid_id,
                "title": title,
                "views": views_fmt,
                "url": f"https://www.youtube.com/watch?v={vid_id}",
                "matched_keywords": kw_hits,
                "protocol_takeaway": (
                    f"Auto-synced via GitHub Actions RSS ({', '.join(kw_hits) if kw_hits else 'General Channel Drop'})."
                )
            })

        merged = live_entries + verified
        merged.sort(key=lambda x: x.get("date", ""), reverse=True)
        return merged[: max(max_items, len(verified))]
    except Exception:
        return verified


def build_radar_feed() -> Dict[str, Any]:
    """Generates the complete 14-creator radar snapshot and writes creator_radar_feed.json."""
    feed_data = {
        "version": "5.0",
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "cloud_automation": ".github/workflows/sync_creator_videos.yml (Every Wed & Sun @ 08:00 AM EST)",
        "cadence_schedule": {
            "tier_a_fast_movers_wed_thu_sun": [
                "Dr. Boz (@DoctorBoz)",
                "Steven Bartlett — The Diary Of A CEO (@TheDiaryOfACEO)",
                "Thomas DeLauer (@ThomasDeLauerOfficial)",
                "Dr. Ben Bikman (@benbikman)",
                "Jack Wiltshire — Sober Fitness (@SoberFitness)"
            ],
            "tier_b_weekly_sunday_0800_sync": [
                "Jeremy Ethier (@JeremyEthier)",
                "Jeff Nippard (@JeffNippard)",
                "Dr. Peter Attia (@PeterAttiaMD)",
                "Dr. Andrew Huberman (@hubermanlab)"
            ],
            "tier_c_biweekly_deep_audit": [
                "Dr. Rhonda Patrick (@FoundMyFitness)",
                "Ryan Humiston (@RyanHumiston)",
                "Bryan Johnson (@BryanJohnson)",
                "Dr. Mike Israetel (@RenaissancePeriodization)",
                "Dr. Keith Baar (@KeithBaarLab)"
            ]
        },
        "total_creators": len(CREATOR_ROSTER),
        "creators": []
    }

    for creator in CREATOR_ROSTER:
        resolved_id = resolve_channel_id(creator)
        drops = fetch_rss_for_creator(creator)
        c_copy = dict(creator)
        if resolved_id and not c_copy.get("channel_id"):
            c_copy["channel_id"] = resolved_id
        c_copy["active_drops"] = drops
        feed_data["creators"].append(c_copy)

    with open(FEED_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(feed_data, f, indent=2)
    return feed_data


def download_new_videos(max_per_creator: int = 1) -> None:
    """Downloads transcripts/subtitles for the newest verified drops via yt-dlp."""
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    feed = build_radar_feed()
    for creator in feed["creators"]:
        for drop in creator["active_drops"][:max_per_creator]:
            vid_id = drop.get("video_id", "")
            if not vid_id or len(vid_id) != 11:
                continue
            url = f"https://www.youtube.com/watch?v={vid_id}"
            out_tmpl = os.path.join(DOWNLOAD_DIR, f"{creator['id']}_{drop['date']}_%(id)s.%(ext)s")
            cmd = [
                "yt-dlp",
                "--write-auto-sub",
                "--sub-lang", "en",
                "--skip-download",
                "-o", out_tmpl,
                url
            ]
            print(f"[Radar Sync] Fetching English transcript for {creator['name']}: {drop['title']} ({url})")
            try:
                subprocess.run(cmd, check=False, timeout=30)
            except Exception as exc:
                print(f"  -> Skipped live yt-dlp fetch ({exc}); metadata logged in {FEED_OUTPUT_PATH}")


def print_roster_summary() -> None:
    feed = build_radar_feed()
    print("=" * 92)
    print(f"SUPER KETOVORE v5.0 — 14-CREATOR RADAR & CLOUD SYNC ENGINE ({feed['generated_at']})")
    print("=" * 92)
    for idx, c in enumerate(feed["creators"], 1):
        print(f"\n{idx:02d}. {c['name']} ({c['handle']} • {c['subscribers']}) — [{c['tier']}]")
        print(f"    Domain   : {c['domain']}")
        print(f"    Genotype : {c['shaun_genotype_link']}")
        print(f"    Cadence  : {c['cadence']}")
        for d in c.get("active_drops", [])[:2]:
            print(f"      * [{d['date']}] {d['title']} ({d.get('views', 'Verified')})")
            print(f"        -> {d['protocol_takeaway']}")
    print(f"\n[OK] Wrote structured 14-creator JSON radar feed to: {FEED_OUTPUT_PATH}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Super Ketovore 14-Creator Video Radar & Sync CLI")
    parser.add_argument("--check", action="store_true", help="Poll creator feeds & write creator_radar_feed.json")
    parser.add_argument("--download-new", action="store_true", help="Fetch English transcripts/videos via yt-dlp")
    parser.add_argument("--roster", action="store_true", help="Print the 14-creator roster and latest drops")
    args = parser.parse_args()

    if args.download_new:
        download_new_videos()
    else:
        print_roster_summary()
