from __future__ import annotations
import os
import sys
import json
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

# Ensure safe UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# pyrefly: ignore [missing-import]
import feedparser
from google import genai
# pyrefly: ignore [missing-import]
from pydantic import BaseModel

# Try to load environment variables from .env if python-dotenv is installed
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Determine base directory and output paths
BASE_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = BASE_DIR / "data.json"
HISTORY_FILE = BASE_DIR / "history.json"

# -----------------------------------------------------------------
# History & Anti-Duplication Helpers
# -----------------------------------------------------------------

def load_seen_urls() -> set[str]:
    """Loads previously selected article URLs from history.json. Resets weekly (after 7 days)."""
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                updated_at_str = data.get("updated_at")
                if updated_at_str:
                    last_update = datetime.fromisoformat(updated_at_str)
                    # Reset history if older than 7 days (1 week)
                    if datetime.now(timezone.utc) - last_update > timedelta(days=7):
                        print("[INFO] history.json is older than 1 week. Resetting history for the new week.")
                        return set()
                return set(data.get("seen_urls", []))
        except Exception as e:
            print(f"[WARN] Failed to load history.json: {e}")
    return set()

def save_seen_urls(new_urls: list[str], existing_urls: set[str]):
    """Saves updated seen URLs to history.json (caps at last 100 URLs (~1 week))."""
    updated = list(existing_urls.union(new_urls))[-100:]
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump({"seen_urls": updated, "updated_at": datetime.now(timezone.utc).isoformat()}, f, indent=2)
        print(f"[INFO] Saved {len(updated)} URLs to history.json")
    except Exception as e:
        print(f"[WARN] Failed to save history.json: {e}")

# -----------------------------------------------------------------
# 1. RSS Feed Sources — split by region
#    Vietnam: targets 8 curated articles
#    World  : targets 7 curated articles
# -----------------------------------------------------------------

VIETNAM_FEEDS = [
    # Tech & Science
    "https://vnexpress.net/rss/khoa-hoc.rss",   # VnExpress - Khoa Hoc
    "https://vnexpress.net/rss/so-hoa.rss",      # VnExpress - So Hoa
    # Business & Startup
    "https://vietcetera.com/rss",                # Vietcetera Business
    # Travel
    "https://vnexpress.net/rss/du-lich.rss",     # VnExpress - Du Lich
]

WORLD_FEEDS = [
    # Robotics & Automation
    "https://spectrum.ieee.org/rss/robotics/fulltext",       # IEEE Spectrum Robotics
    "https://www.automationworld.com/rss",                   # Automation World
    "https://www.roboticsbusinessreview.com/feed/",          # Robotics Business Review
    # Energy & Green Tech
    "https://cleantechnica.com/feed/",                       # CleanTechnica
    "https://www.canarymedia.com/rss.xml",                   # Canary Media
    "https://www.renewableenergyworld.com/feed/",            # Renewable Energy World
    # Jobs & Tech Markets
    "https://hnrss.org/best",                                # Hacker News Best
    "https://www.technologyreview.com/feed/",                # MIT Technology Review
    # Health & Wellness
    "https://www.sciencedaily.com/rss/health_medicine.xml",  # ScienceDaily Health
    "https://medium.com/feed/tag/health",                    # Medium Health
    # Travel
    "https://feeds.bbci.co.uk/news/world/rss.xml",           # BBC World / Travel
]

# Max age threshold for articles (3 days)
MAX_AGE_DAYS = 3


def is_recent(entry) -> bool:
    """Checks if feed entry is within MAX_AGE_DAYS (if published date is present)."""
    parsed_time = entry.get("published_parsed") or entry.get("updated_parsed")
    if not parsed_time:
        return True  # Keep if date is missing
    try:
        pub_dt = datetime.fromtimestamp(time.mktime(parsed_time), tz=timezone.utc)
        cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
        return pub_dt >= cutoff
    except Exception:
        return True


def fetch_feed(args: tuple[str, set[str]]) -> list[str]:
    """Fetches a single feed, filtering by age and previously seen URLs."""
    url, seen_urls = args
    try:
        feed = feedparser.parse(url)
        valid_items = []
        for entry in feed.entries:
            link = entry.get("link", "").strip()
            if not link or link in seen_urls:
                continue
            if not is_recent(entry):
                continue
            title = entry.get("title", "").strip()
            summary = entry.get("summary", "").strip()
            valid_items.append(f"Title: {title}\nLink: {link}\nSummary: {summary}")
            if len(valid_items) >= 10:
                break
        return valid_items
    except Exception as e:
        print(f"[WARN] Failed to fetch {url}: {e}")
        return []


def fetch_region(feeds: list[str], label: str, seen_urls: set[str]) -> str:
    """Fetches all feeds for a region concurrently and returns a single text block."""
    args_list = [(feed_url, seen_urls) for feed_url in feeds]
    with ThreadPoolExecutor(max_workers=16) as executor:
        results = list(executor.map(fetch_feed, args_list))
    articles = [item for sublist in results for item in sublist]
    print(f"[INFO] {label}: {len(articles)} fresh & unseen raw articles fetched from {len(feeds)} feeds")
    return "\n\n".join(articles)


# -----------------------------------------------------------------
# 2. Pydantic schema — Gemini enforces strict JSON output
# -----------------------------------------------------------------

class Article(BaseModel):
    title: str
    summary: str
    url: str

class TopNews(BaseModel):
    articles: list[Article]


# -----------------------------------------------------------------
# 3. Main
# -----------------------------------------------------------------

def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[ERROR] GEMINI_API_KEY environment variable is not set.")
        print(" -> To fix: create a .env file with GEMINI_API_KEY=your_key or set it in your terminal:")
        print('    PowerShell: $env:GEMINI_API_KEY="your_key"')
        print('    CMD:        set GEMINI_API_KEY="your_key"')
        print('    Mac/Linux:  export GEMINI_API_KEY="your_key"')
        return

    seen_urls = load_seen_urls()
    print(f"[INFO] Loaded {len(seen_urls)} previously seen URLs from history.json")

    print("[INFO] Fetching RSS feeds by region (filtering < 3 days old & non-duplicate)...")
    vietnam_text = fetch_region(VIETNAM_FEEDS, "Vietnam", seen_urls)
    world_text   = fetch_region(WORLD_FEEDS,   "World",   seen_urls)

    if not vietnam_text and not world_text:
        print("[WARN] No fresh articles could be fetched. Clearing history buffer fallback.")
        seen_urls.clear()
        vietnam_text = fetch_region(VIETNAM_FEEDS, "Vietnam", seen_urls)
        world_text   = fetch_region(WORLD_FEEDS,   "World",   seen_urls)

    if not vietnam_text and not world_text:
        print("[WARN] No articles could be fetched. Please check your connection or feed URLs.")
        return

    print("[INFO] Sending to Gemini for curation...")
    client = genai.Client(api_key=api_key)

    prompt = f"""
You are a strict news curator. Your task is to select exactly 15 articles in total:
  - EXACTLY 8 articles from the VIETNAM section
  - EXACTLY 7 articles from the WORLD section

Topics of interest: factory automation, robotics, AI, green energy, health & wellness, travel, tech startups, science.

Hard rules:
  - Discard rage-bait, celebrity gossip, sports scores, and toxic/political controversy.
  - Prefer actionable insights and positive, informative stories.
  - Write a clear 3-sentence summary for each selected article.
  - Return all 15 articles in a single flat list (Vietnam articles first, then World articles).

=== VIETNAM ARTICLES ===
{vietnam_text}

=== WORLD ARTICLES ===
{world_text}
"""

    models_to_try = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-1.5-flash']
    response = None

    for model_name in models_to_try:
        for attempt in range(3):
            try:
                print(f"[INFO] Curation attempt {attempt + 1} using model '{model_name}'...", flush=True)
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config={
                        'response_mime_type': 'application/json',
                        'response_schema': TopNews,
                        'temperature': 0.2,
                    },
                )
                if response and response.text:
                    print(f"[SUCCESS] Curated successfully with {model_name}", flush=True)
                    break
            except Exception as e:
                print(f"[WARN] Model '{model_name}' attempt {attempt + 1} failed: {e}", flush=True)
                time.sleep(3 * (attempt + 1))
        if response and response.text:
            break

    if not response or not response.text:
        print("[ERROR] All Gemini models failed to generate daily news.")
        return

    # Save the clean JSON for the Frontend
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(response.text)

    print(f"[SUCCESS] {OUTPUT_FILE.name} has been created at {OUTPUT_FILE}")

    # Track newly selected URLs in history.json
    try:
        result_data = json.loads(response.text)
        new_urls = [a["url"] for a in result_data.get("articles", []) if "url" in a]
        save_seen_urls(new_urls, seen_urls)
    except Exception as e:
        print(f"[WARN] Could not update history.json: {e}")


if __name__ == "__main__":
    main()
