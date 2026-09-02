from __future__ import annotations
import os
import sys
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import List

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

# Determine base directory and output path
BASE_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = BASE_DIR / "data.json"

# 1. Your customized list of RSS Feeds
FEEDS = [
    "https://vnexpress.net/rss/khoa-hoc.rss",
    "https://spectrum.ieee.org/rss/robotics/fulltext",
    "https://cleantechnica.com/feed/",
    "https://hnrss.org/best",
    "https://vietcetera.com/rss",
    "https://www.sciencedaily.com/rss/health_medicine.xml"
]

def fetch_feed(url: str) -> list[str]:
    """Fetches a single feed and returns the top 10 articles as text."""
    try:
        feed = feedparser.parse(url)
        # Grab only the top 10 newest articles per feed to avoid context bloat
        return [
            f"Title: {entry.title}\nLink: {entry.link}\nSummary: {entry.get('summary', '')}"
            for entry in feed.entries[:10]
        ]
    except Exception as e:
        print(f"[WARN] Failed to fetch {url}: {e}")
        return []

# 2. Define the JSON Structure (Pydantic enforces perfect JSON output)
class Article(BaseModel):
    title: str
    summary: str
    url: str

class TopNews(BaseModel):
    articles: list[Article]

def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[ERROR] GEMINI_API_KEY environment variable is not set.")
        print(" -> To fix: create a .env file with GEMINI_API_KEY=your_key or set it in your terminal:")
        print("    PowerShell: $env:GEMINI_API_KEY=\"your_key\"")
        print("    CMD:        set GEMINI_API_KEY=\"your_key\"")
        print("    Mac/Linux:  export GEMINI_API_KEY=\"your_key\"")
        return

    print("[INFO] Fetching RSS feeds concurrently...")
    # Fetch all feeds simultaneously using ThreadPool
    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(fetch_feed, FEEDS))

    # Flatten the list of lists into a single text block
    all_articles = [item for sublist in results for item in sublist]
    articles_text = "\n\n".join(all_articles)
    print(f"[INFO] Total articles fetched: {len(all_articles)}")

    if not all_articles:
        print("[WARN] No articles could be fetched. Please check your internet connection or feed URLs.")
        return

    # 3. Call the Gemini API 
    print("[INFO] Sending to Gemini for curation...")
    client = genai.Client(api_key=api_key)

    prompt = f"""
You are a strict news curator. Review the following articles. 
Select EXACTLY the top 7 most relevant to: factory automation, robotics, green energy, health, reading, and travel.
Immediately discard any rage-bait, celebrity gossip, or toxic news.
Provide a 3-sentence summary for each selected article.

Articles to evaluate:
{articles_text}
"""

    response = client.models.generate_content(
        model='gemini-3.6-flash',
        contents=prompt,
        config={
            'response_mime_type': 'application/json',
            'response_schema': TopNews,
            'temperature': 0.2, # Analytical and factual
        },
    )

    # 4. Save the clean JSON for your Frontend
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(response.text)

    print(f"[SUCCESS] {OUTPUT_FILE.name} has been created at {OUTPUT_FILE}")

if __name__ == "__main__":
    main()