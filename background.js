/**
 * @file background.js
 * @description Service worker for the Trinetra AI Web Guardian extension.
 * It handles communication with content scripts, manages API calls to Google Gemini
 * for website analysis, monitors network requests and downloads, and updates the UI.
 *
 * @author Pradumon Sahani
 * @version 1.3
 */

// Constants for Trinetra
const TRINETRA_LOG_PREFIX = "Trinetra Background:";
const GEMINI_API_MODEL = 'gemini-1.5-flash-latest'; // Using Gemini 1.5 Flash for speed and efficiency
const MAX_DATA_PAYLOAD_CHARS = 30000; // Max characters for the JSON payload to Gemini
const MAX_HTML_SNIPPET_CHARS = 10000; // Max characters for HTML snippets
const MAX_TEXT_SNIPPET_CHARS = 5000;  // Max characters for visible text snippets
const ANALYSIS_CACHE_DURATION_MS = 3 * 60 * 1000; // 3 minutes cache for analysis results

// Whitelisted domains that are generally considered safe and bypass AI analysis
const WHITELISTED_DOMAINS = [
    'google.com', 'youtube.com', 'gmail.com',
    'github.com', 'stackoverflow.com',
    'developer.chrome.com', 'developer.mozilla.org',
    'wikipedia.org', 'medium.com'
];

// Global store for analysis results per tabId
let tabAnalysisResults = {};
// Set to store URLs that the user has explicitly chosen to proceed to during the current session
let sessionProceededUrls = new Set();

/**
 * Utility function to extract the base domain from a URL.
 * @param {string} url The URL to parse.
 * @returns {string|null} The extracted domain name (e.g., "example.com") or null if parsing fails.
 */
function getDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
        // console.error(TRINETRA_LOG_PREFIX, "Failed to parse domain from URL:", url, e);
        return null;
    }
}

/**
 * Retrieves the stored Gemini API key from chrome.storage.local.
 * @returns {Promise<string|undefined>} A promise that resolves to the API key or undefined if not set.
 */
async function getApiKey() {
    const { apiKey } = await chrome.storage.local.get('apiKey');
    return apiKey;
}

/**
 * Truncates a given text string to a maximum length, appending an ellipsis if truncated.
 * @param {string} text The text to truncate.
 * @param {number} maxLength The maximum allowed length for the text.
 * @returns {string} The (potentially) truncated text.
 */
function truncateText(text, maxLength) {
    if (!text) return "";
    return text.length > maxLength ? text.substring(0, maxLength - 3) + "..." : text;
}

/**
 * Extracts relevant snippets from the HTML source for analysis.
 * Focuses on <head> content, forms, and initial script tags.
 * @param {string} htmlString The full HTML source of the page.
 * @returns {string} A string containing concatenated snippets of relevant HTML.
 */
function extractRelevantHtml(htmlString) {
    let relevantSnippets = "";

    // Extract <head> content
    const headMatch = htmlString.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (headMatch && headMatch[1]) {
        relevantSnippets += "HEAD_CONTENT:\n" + truncateText(headMatch[1].replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ''), MAX_HTML_SNIPPET_CHARS / 3) + "\n\n";
    }

    // Extract up to 5 form elements
    const forms = Array.from(htmlString.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/gi));
    if (forms.length > 0) {
        relevantSnippets += "FORMS_CONTENT:\n";
        forms.slice(0, 5).forEach((formMatch, index) => {
            relevantSnippets += `Form ${index + 1}:\n` + truncateText(formMatch[0], MAX_HTML_SNIPPET_CHARS / 4) + "\n";
        });
        relevantSnippets += "\n";
    }
    
    // Extract initial script tags (both src and inline, max 5)
    const scriptMatches = Array.from(htmlString.matchAll(/<script[^>]*src="[^"]*"[^>]*>[\s\S]*?<\/script>|<script(?![^>]*type=["'](application\/ld\+json|text\/html)["'])[^>]*>([\s\S]*?)<\/script>/gi));
    if (scriptMatches.length > 0) {
        relevantSnippets += "INITIAL_SCRIPTS_CONTENT:\n";
        scriptMatches.slice(0, 5).forEach((scriptMatch, index) => {
            relevantSnippets += `Script ${index + 1}:\n` + truncateText(scriptMatch[0], MAX_HTML_SNIPPET_CHARS / 5) + "\n";
        });
    }
    
    return truncateText(relevantSnippets, MAX_HTML_SNIPPET_CHARS);
}

/**
 * Analyzes the provided page data using the Google Gemini API.
 * Constructs a detailed prompt and sends the data for threat assessment.
 * Updates tab status based on the AI's response.
 * @param {object} pageData The data extracted from the web page by content.js.
 * @param {number} tabId The ID of the tab being analyzed.
 */
async function analyzeWithAI(pageData, tabId) {
    const apiKey = await getApiKey();
    if (!apiKey) {
        console.warn(TRINETRA_LOG_PREFIX, "Gemini API key not set. Analysis aborted for URL:", pageData.url);
        updateTabStatus(tabId, pageData.url, "ERROR", "Gemini API key is missing. Please set it in the Trinetra popup.");
        return;
    }

    const domain = getDomain(pageData.url);
    if (domain && WHITELISTED_DOMAINS.some(whitelistedDomain => domain.endsWith(whitelistedDomain))) {
        // console.log(TRINETRA_LOG_PREFIX, `URL ${pageData.url} is whitelisted. Skipping AI analysis.`);
        updateTabStatus(tabId, pageData.url, "SAFE", "This domain is on Trinetra's trusted whitelist.");
        return;
    }

    if (sessionProceededUrls.has(pageData.url)) {
        // console.log(TRINETRA_LOG_PREFIX, `User previously proceeded to ${pageData.url}. Marking as safe for this session.`);
        updateTabStatus(tabId, pageData.url, "SAFE", "You chose to proceed to this page earlier in this session.");
        return;
    }

    // Prepare data payload for the AI
    const dataToAnalyze = {
        current_url: pageData.url,
        page_title: truncateText(pageData.title, 200),
        visible_text_snippet: truncateText(pageData.visibleText, MAX_TEXT_SNIPPET_CHARS),
        key_html_elements_snippet: extractRelevantHtml(pageData.html),
        external_script_urls: pageData.scripts.filter(s => s && !s.startsWith(pageData.url.origin)).slice(0, 15),
        form_details: pageData.forms.map(f => ({
            action_url: f.action ? new URL(f.action, pageData.url).href : "N/A", // Resolve relative URLs
            method: f.method,
            number_of_inputs: f.inputs.length,
        })).slice(0, 7),
        iframe_sources: pageData.iframes.filter(s => s).slice(0, 7).map(s => new URL(s, pageData.url).href),
        external_links_sample: pageData.links.filter(l => l && !l.startsWith(pageData.url.origin)).slice(0,15)
    };

    const jsonDataString = JSON.stringify(dataToAnalyze, null, 2);
    const truncatedJsonData = truncateText(jsonDataString, MAX_DATA_PAYLOAD_CHARS);

    // Construct the prompt for Gemini AI
    const prompt = `
You are Trinetra AI, an advanced cybersecurity analyst powered by Google Gemini 1.5 Flash. Your primary objective is to meticulously examine the provided website data and determine its safety level with utmost precision and speed.
The website data includes: current URL, page title, a snippet of visible text, key HTML elements (like forms, head content, and script sources), iframe sources, and a sample of external links.

Critically evaluate the data for the following threat vectors:
1.  **Phishing & Credential Theft**:
    *   Does the site deceptively mimic legitimate services (banks, social media, email providers) to steal credentials, financial details, or personal identifiable information (PII)?
    *   Analyze the current_url for common phishing tactics: typosquatting (e.g., "paypa1.com" instead of "paypal.com"), misleading subdomains (e.g., "paypal.com.secure-login.biz"), use of non-standard Top-Level Domains (TLDs) for the purported service, or excessive use of hyphens.
    *   Examine form_details: Do forms request sensitive information like passwords, credit card numbers, social security numbers, or recovery phrases? Where do these forms submit data (action_url)? Are these action URLs on the same domain, or do they point to a suspicious third-party domain?
    *   Is there urgent, threatening, or overly enticing language in visible_text_snippet or page_title designed to pressure users into immediate action or information disclosure?
2.  **Malware Distribution & Harmful Code Injection**:
    *   Are there indicators of malicious scripts, drive-by downloads, cryptojackers, or links to known malware distribution networks?
    *   Scrutinize external_script_urls and iframe_sources: Do they originate from unknown, unverified, recently registered, or historically problematic domains? Are there an excessive number of scripts/iframes from disparate sources?
    *   Look for signs of obfuscated JavaScript within key_html_elements_snippet (though direct code analysis is limited, patterns in script tags or suspicious inline scripts can be indicative).
    *   Does the visible_text_snippet or page_title mention unexpected downloads, required software updates from unofficial sources, or browser extension installations?
3.  **Deceptive Practices & Social Engineering (Scams, Misleading Ads)**:
    *   Does the site employ scareware tactics (e.g., fake virus alerts, "system critical error" messages), misleading pop-ups, or fake endorsements to trick users into unwanted actions?
    *   Are there attempts to push users into installing Potentially Unwanted Programs (PUPs), adware, or subscribing to costly, valueless services?
    *   Does visible_text_snippet or page_title contain exaggerated claims, get-rich-quick schemes, or fake testimonials?
4.  **General Suspicious Behavior & Technical Red Flags**:
    *   URL anomalies: Beyond phishing, does the URL structure itself seem suspicious (e.g., extremely long, random characters, multiple redirections implied by complexity)?
    *   Content quality: Does the visible_text_snippet appear auto-generated, nonsensical, or have numerous grammatical errors, suggesting a low-effort or malicious site?
    *   Aggressive advertising: While not directly visible, an abundance of external_links_sample pointing to known ad networks or very short link domains could imply aggressive ad behavior.
    *   Overuse of iframes loading content from many different, unrelated domains can be a sign of malvertising or session hijacking attempts.

Based on your comprehensive analysis of ONLY the provided data, classify the website and provide your response in the following strict JSON format:
{
  "status": "[SAFE|SUSPICIOUS|DANGEROUS]",
  "explanation": "[A concise, 1-3 sentence explanation for your classification, highlighting the key reasons derived from the input data. Be specific and actionable where possible. For example, if phishing, mention what cues led to that conclusion.]",
  "confidence_score": "[A numerical score from 0.0 to 1.0 indicating your confidence in the status, e.g., 0.95 for high confidence in DANGEROUS. Aim for realistic confidence based on available data.]",
  "primary_threat_type": "[If DANGEROUS or SUSPICIOUS, categorize the main threat: PHISHING, MALWARE, DECEPTIVE_PRACTICE, SPAM, LOW_QUALITY, OTHER. If SAFE, use N/A.]"
}

Website Data:
${truncatedJsonData}
    `;

    // console.log(TRINETRA_LOG_PREFIX, `Sending data (approx ${truncatedJsonData.length} chars) to Gemini for URL:`, pageData.url);
    const GEMINI_API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_API_MODEL}:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(GEMINI_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1, // Low temperature for factual, deterministic security assessment
                    maxOutputTokens: 300, // Sufficient for the JSON response
                    responseMimeType: "application/json", // Request JSON output directly
                }
            })
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => response.text());
            console.error(TRINETRA_LOG_PREFIX, "Gemini API Error:", response.status, errorBody);
            let errorMsg = `Gemini API request failed: ${response.statusText}`;
            if (typeof errorBody === 'object' && errorBody.error && errorBody.error.message) {
                errorMsg += ` - ${errorBody.error.message}`;
            } else if (typeof errorBody === 'string') {
                errorMsg += ` - ${truncateText(errorBody, 150)}`;
            }
            updateTabStatus(tabId, pageData.url, "ERROR", errorMsg);
            return;
        }

        const resultText = await response.text();
        let resultJson;
        try {
            resultJson = JSON.parse(resultText);
        } catch (e) {
             console.error(TRINETRA_LOG_PREFIX, "Failed to parse Gemini API response as JSON:", resultText, e);
             updateTabStatus(tabId, pageData.url, "ERROR", "Trinetra AI response was not valid JSON.");
             return;
        }
        
        if (resultJson.candidates && resultJson.candidates[0].content && resultJson.candidates[0].content.parts && resultJson.candidates[0].content.parts[0].text) {
            const aiResponseText = resultJson.candidates[0].content.parts[0].text;
            // console.log(TRINETRA_LOG_PREFIX, "Gemini AI Raw Response Part:", aiResponseText);

            let aiAnalysis;
            try {
                aiAnalysis = JSON.parse(aiResponseText); // Gemini should return valid JSON as per responseMimeType
            } catch (e) {
                console.error(TRINETRA_LOG_PREFIX, "Could not parse AI's text part as JSON:", aiResponseText, e);
                updateTabStatus(tabId, pageData.url, "ERROR", `Trinetra AI response content format error. Details: ${truncateText(aiResponseText, 100)}`);
                return;
            }
            
            if (aiAnalysis && aiAnalysis.status && aiAnalysis.explanation) {
                const normalizedStatus = aiAnalysis.status.toUpperCase().trim();
                if (["SAFE", "SUSPICIOUS", "DANGEROUS"].includes(normalizedStatus)) {
                    let explanation = aiAnalysis.explanation;
                    if (aiAnalysis.confidence_score) explanation += ` (Confidence: ${(aiAnalysis.confidence_score * 100).toFixed(0)}%)`;
                    if (aiAnalysis.primary_threat_type && aiAnalysis.primary_threat_type !== "N/A") explanation += ` [Threat: ${aiAnalysis.primary_threat_type}]`;
                    updateTabStatus(tabId, pageData.url, normalizedStatus, explanation);
                } else {
                     updateTabStatus(tabId, pageData.url, "SUSPICIOUS", `Trinetra AI provided an unknown status: ${aiAnalysis.status}. Explanation: ${aiAnalysis.explanation}`);
                }
            } else {
                 console.error(TRINETRA_LOG_PREFIX, "Parsed AI JSON missing required fields (status/explanation):", aiAnalysis);
                 updateTabStatus(tabId, pageData.url, "ERROR", "Trinetra AI response structure incomplete.");
            }

        } else if (resultJson.promptFeedback && resultJson.promptFeedback.blockReason) {
            let blockDetail = `Blocked: ${resultJson.promptFeedback.blockReason}`;
            if (resultJson.promptFeedback.safetyRatings) {
                blockDetail += ` - Ratings: ${JSON.stringify(resultJson.promptFeedback.safetyRatings)}`;
            }
            console.error(TRINETRA_LOG_PREFIX, "Prompt blocked by Gemini API.", blockDetail);
            updateTabStatus(tabId, pageData.url, "ERROR", `Trinetra AI analysis blocked by content safety filter: ${resultJson.promptFeedback.blockReason}`);
        } else {
            console.error(TRINETRA_LOG_PREFIX, "Unexpected Gemini AI response structure:", resultJson);
            updateTabStatus(tabId, pageData.url, "ERROR", "Could not extract content from Trinetra AI response (unexpected structure).");
        }

    } catch (error) {
        console.error(TRINETRA_LOG_PREFIX, "Error calling Gemini API:", error);
        updateTabStatus(tabId, pageData.url, "ERROR", `Network error or issue calling Trinetra AI backend: ${error.message}`);
    }
}

/**
 * Updates the analysis status for a given tab and notifies the popup UI.
 * Also triggers system notifications for dangerous or suspicious sites.
 * @param {number} tabId The ID of the tab.
 * @param {string} url The URL of the page analyzed.
 * @param {string} status The analysis status (SAFE, SUSPICIOUS, DANGEROUS, ERROR).
 * @param {string} explanation A brief explanation of the status.
 */
function updateTabStatus(tabId, url, status, explanation) {
    tabAnalysisResults[tabId] = {
        url: url,
        status: status,
        explanation: explanation,
        timestamp: Date.now()
    };
    // Notify popup UI if open
    chrome.runtime.sendMessage({ type: "UPDATE_POPUP_DATA", data: tabAnalysisResults[tabId] }).catch(e => {
        // Error sending message typically means popup is not open, which is fine.
        // if (e.message.includes("Could not establish connection")) console.log(TRINETRA_LOG_PREFIX, "Popup not open for UI update.");
        // else console.warn(TRINETRA_LOG_PREFIX, "Error sending update to popup:", e);
    });

    // Trigger system notifications for concerning statuses
    const domainName = getDomain(url) || url;
    if (status === "DANGEROUS") {
        chrome.notifications.create(tabId.toString() + "_trinetra_danger", {
            type: "basic",
            iconUrl: "icon.png",
            title: "Trinetra Alert: DANGEROUS Site!",
            message: `Page: ${domainName}\nTrinetra AI flags this site as DANGEROUS.\nDetails: ${truncateText(explanation, 100)}`,
            priority: 2,
            buttons: [{ title: "Go Back" }, { title: "View Details"}]
        });
    } else if (status === "SUSPICIOUS") {
         chrome.notifications.create(tabId.toString() + "_trinetra_suspicious", {
            type: "basic",
            iconUrl: "icon.png",
            title: "Trinetra Warning: Suspicious Site",
            message: `Page: ${domainName}\nTrinetra AI flags this site as SUSPICIOUS.\nDetails: ${truncateText(explanation, 100)}`,
            priority: 1
            // No buttons for suspicious, to reduce notification fatigue. User can check popup.
        });
    }
}

/**
 * Handles clicks on notification buttons.
 * @param {string} notificationId The ID of the clicked notification.
 * @param {number} buttonIndex The index of the button that was clicked.
 */
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    // Extract tabId from notificationId (e.g., "123_trinetra_danger")
    const tabIdStr = notificationId.split("_")[0];
    const tabId = parseInt(tabIdStr);

    if (!isNaN(tabId)) {
        if (buttonIndex === 0) { // "Go Back" button
            chrome.tabs.goBack(tabId, () => {
                if (chrome.runtime.lastError) {
                    // console.warn(TRINETRA_LOG_PREFIX, "Could not go back for tab", tabId, chrome.runtime.lastError.message);
                }
            });
        } else if (buttonIndex === 1) { // "View Details" button (for DANGEROUS notifications)
            // Attempt to focus the tab and inform user to click extension icon.
            // Programmatically opening popup is restricted for security.
            chrome.tabs.update(tabId, { active: true }, (tab) => {
                if (tab) chrome.windows.update(tab.windowId, { focused: true });
                 chrome.notifications.create(tabId.toString() + "_trinetra_popup_info", {
                    type: "basic", iconUrl: "icon.png", title: "Trinetra Web Guardian",
                    message: "Please click the Trinetra icon in your toolbar to see full details and options for this page.", priority: 0
                });
            });
        }
    }
    chrome.notifications.clear(notificationId); // Clear the notification after interaction
});

// --- Event Listeners for Browser Actions ---

// Listener for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "PAGE_DATA") {
        const tabId = sender.tab?.id;
        if (tabId) {
            // console.log(TRINETRA_LOG_PREFIX, "Received page data for tab", tabId, "URL:", request.data.url);
            const existingResult = tabAnalysisResults[tabId];
            // Check cache or if user proceeded
            if (existingResult && existingResult.url === request.data.url &&
                (sessionProceededUrls.has(request.data.url) || (Date.now() - existingResult.timestamp < ANALYSIS_CACHE_DURATION_MS))) {
                // console.log(TRINETRA_LOG_PREFIX, "Using cached/proceeded result for", request.data.url);
                chrome.runtime.sendMessage({ type: "UPDATE_POPUP_DATA", data: existingResult }).catch(e => {});
                sendResponse({ status: "Using cached/proceeded Trinetra result." });
                return true;
            }
            analyzeWithAI(request.data, tabId);
            sendResponse({ status: "Trinetra analysis initiated with Gemini 1.5 Flash." });
        }
    } else if (request.type === "GET_TAB_STATUS") {
        const tabId = request.tabId;
        sendResponse(tabAnalysisResults[tabId] || { status: "PENDING", explanation: "Trinetra is analyzing or no data yet..." });
    } else if (request.type === "GO_BACK_TAB") {
        if (request.tabId) {
            chrome.tabs.goBack(request.tabId, () => {
                if (chrome.runtime.lastError) { /* console.warn(TRINETRA_LOG_PREFIX, "Error on GO_BACK_TAB:", chrome.runtime.lastError.message); */ }
            });
            sendResponse({ success: true });
        }
    } else if (request.type === "PROCEED_ANYWAY") {
        if (request.tabId && tabAnalysisResults[request.tabId]) {
            const urlToProceed = tabAnalysisResults[request.tabId].url;
            sessionProceededUrls.add(urlToProceed);
            updateTabStatus(request.tabId, urlToProceed, "SAFE", "You chose to proceed. Trinetra will trust this page for this session.");
            sendResponse({ success: true, newStatus: tabAnalysisResults[request.tabId] });
        } else {
            sendResponse({ success: false });
        }
    }
    return true; // Keep message channel open for asynchronous response
});

// Listener for tab updates (e.g., navigation to a new page within the same tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Trigger analysis when a tab finishes loading a new http/https URL
    if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        // console.log(TRINETRA_LOG_PREFIX, "Tab updated and complete:", tabId, tab.url);
        // Clear old result if domain changed significantly, to force re-analysis
        if (tabAnalysisResults[tabId] && getDomain(tabAnalysisResults[tabId].url) !== getDomain(tab.url)) {
             tabAnalysisResults[tabId] = null;
        }
        // Content script (content.js) is set to run at document_idle, so it should automatically
        // send PAGE_DATA upon new page loads. If issues arise with SPAs, explicit re-injection might be needed here.
    }
});

// Listener for tab removal to clean up stored analysis results
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    delete tabAnalysisResults[tabId];
    // console.log(TRINETRA_LOG_PREFIX, "Cleaned up analysis data for closed tab:", tabId);
});

// Listener for new file downloads
chrome.downloads.onCreated.addListener((downloadItem) => {
    const suspiciousExtensions = [
        '.exe', '.bat', '.msi', '.apk', '.dmg', '.cmd', '.scr', '.js', '.vbs',
        '.jar', '.ps1', '.docm', '.xlsm', '.pptm', '.iso', '.com'
    ];
    const filename = downloadItem.filename.toLowerCase();
    if (suspiciousExtensions.some(ext => filename.endsWith(ext))) {
        console.warn(TRINETRA_LOG_PREFIX, "Suspicious file download detected:", downloadItem.filename, "from URL:", downloadItem.url);
        chrome.notifications.create(`trinetra_download_alert_${downloadItem.id}`, {
            type: 'basic', iconUrl: 'icon.png', title: 'Trinetra: Suspicious Download!',
            message: `File: ${downloadItem.filename}\nThis file type (${filename.substring(filename.lastIndexOf('.'))}) can be dangerous. Verify the source before opening.`,
            priority: 2
        });
    }
});

// Listener for web requests (primarily for logging and potential future advanced heuristics)
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        // Log cross-domain POST requests, which can sometimes be indicative of phishing or data exfiltration
        if (details.method === "POST" && details.requestBody && details.requestBody.formData) {
            const initiatorDomain = details.initiator ? getDomain(details.initiator) : 'unknown';
            const targetDomain = getDomain(details.url);
            if (initiatorDomain !== 'unknown' && targetDomain && initiatorDomain !== targetDomain) {
                console.warn(TRINETRA_LOG_PREFIX, `Cross-domain POST detected: From ${initiatorDomain} to ${targetDomain}. URL: ${details.url}, Tab: ${details.tabId}`);
                // This could be a future input to the AI or trigger a more intensive scan.
            }
        }
    },
    { urls: ["<all_urls>"] },
    ["requestBody"]
);

// Log redirects, multiple quick redirects could be suspicious.
chrome.webRequest.onBeforeRedirect.addListener(
    (details) => {
        // console.log(TRINETRA_LOG_PREFIX, `Redirect on tab ${details.tabId}: ${details.url} -> ${details.redirectUrl}`);
    },
    { urls: ["<all_urls>"] }
);

// Initial log message when the background script starts
console.log(TRINETRA_LOG_PREFIX, "Service Worker v1.3 (Pradumon Sahani) loaded and active.");