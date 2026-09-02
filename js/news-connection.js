// js/news-connection.js

/**
 * Fetches curated news articles from the generated data.json endpoint.
 * @param {string} [endpoint='./data.json'] - Path or URL to data.json
 * @returns {Promise<Array<{title: string, summary: string, url: string}>>}
 */
export async function fetchNewsArticles(endpoint = './data.json') {
    try {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            cache: 'no-cache'
        });

        if (!response.ok) {
            throw new Error(`Failed to load news: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.articles || [];
    } catch (error) {
        console.error('Data connection error:', error);
        throw error;
    }
}

/**
 * Connection wrapper handling lifecycle events (Loading, Success, Error).
 * Pass custom render/UI callbacks to plug in your own design elements.
 * 
 * @param {Object} config
 * @param {string} [config.endpoint] - Optional custom endpoint path
 * @param {Function} [config.onLoading] - Called before fetch starts
 * @param {Function} [config.onSuccess] - Receives array of article objects
 * @param {Function} [config.onError] - Receives the Error instance
 */
export async function connectNewsFeed({ endpoint, onLoading, onSuccess, onError }) {
    if (typeof onLoading === 'function') {
        onLoading();
    }

    try {
        const articles = await fetchNewsArticles(endpoint);
        if (typeof onSuccess === 'function') {
            onSuccess(articles);
        }
    } catch (error) {
        if (typeof onError === 'function') {
            onError(error);
        }
    }
}