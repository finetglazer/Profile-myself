// js/saved-news-service.js

const JSONBIN_CONFIG = {
    MASTER_KEY: '$2a$10$AnsM5bqZ28X4Lxhm/y93rO0axX0Gan0upBlB2fietCgpbHtL1ri7O',
    BIN_ID: '6a97e6baf5f4af5e2960203e',
    get URL() { return `https://api.jsonbin.io/v3/b/${this.BIN_ID}`; }
};

const LOCAL_KEY = 'daily_news_saved_articles';

/**
 * Gets cached saved articles from localStorage
 * @returns {Array}
 */
export function getLocalSavedArticles() {
    try {
        const stored = localStorage.getItem(LOCAL_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.warn('LocalStorage error:', e);
        return [];
    }
}

/**
 * Saves articles to localStorage
 * @param {Array} articles 
 */
export function setLocalSavedArticles(articles) {
    try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(articles));
    } catch (e) {
        console.warn('LocalStorage save error:', e);
    }
}

/**
 * Fetches saved articles from JSONBin.io (with fallback to local storage)
 * @returns {Promise<Array>}
 */
export async function fetchSavedArticles() {
    try {
        const res = await fetch(JSONBIN_CONFIG.URL + '/latest', {
            method: 'GET',
            headers: {
                'X-Master-Key': JSONBIN_CONFIG.MASTER_KEY
            },
            cache: 'no-cache'
        });

        if (!res.ok) throw new Error(`JSONBin error: ${res.status}`);
        
        const json = await res.json();
        const articles = json.record?.articles || [];
        setLocalSavedArticles(articles);
        return articles;
    } catch (err) {
        console.warn('JSONBin fetch failed, using local cache:', err);
        return getLocalSavedArticles();
    }
}

/**
 * Syncs updated articles array to JSONBin.io
 * @param {Array} articles 
 * @returns {Promise<boolean>}
 */
export async function syncSavedArticlesToBin(articles) {
    setLocalSavedArticles(articles);
    try {
        const res = await fetch(JSONBIN_CONFIG.URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_CONFIG.MASTER_KEY
            },
            body: JSON.stringify({ articles: articles, updatedAt: new Date().toISOString() })
        });
        return res.ok;
    } catch (err) {
        console.error('JSONBin sync failed:', err);
        return false;
    }
}

/**
 * Toggles saved status of an article.
 * @param {Object} article { title, summary, url }
 * @returns {Promise<{isSaved: boolean, count: number}>}
 */
export async function toggleSaveArticle(article) {
    let current = getLocalSavedArticles();
    const existingIndex = current.findIndex(a => a.url === article.url);
    let isSaved = false;

    if (existingIndex >= 0) {
        // Remove
        current.splice(existingIndex, 1);
        isSaved = false;
    } else {
        // Save (with saved timestamp)
        current.unshift({
            ...article,
            savedAt: new Date().toISOString()
        });
        isSaved = true;
    }

    await syncSavedArticlesToBin(current);
    return { isSaved, count: current.length };
}

/**
 * Checks if article URL is saved
 * @param {string} url 
 * @returns {boolean}
 */
export function isArticleSaved(url) {
    const current = getLocalSavedArticles();
    return current.some(a => a.url === url);
}
