/**
 * @file popup.js
 * @description Handles the logic for the Trinetra AI Web Guardian browser action popup.
 * It manages API key input, displays analysis results, and facilitates user actions
 * like navigating back or proceeding to a flagged page.
 *
 * @author Pradumon Sahani
 * @version 1.3
 */

// Constants for Trinetra logging
const TRINETRA_POPUP_LOG_PREFIX = "Trinetra Popup:";

document.addEventListener('DOMContentLoaded', async () => {
    // DOM Element References
    const statusMessageEl = document.getElementById('statusMessage');
    const explanationEl = document.getElementById('explanation');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveApiKeyButton = document.getElementById('saveApiKeyButton');
    const clearApiKeyButton = document.getElementById('clearApiKeyButton');
    const apiKeyMessageEl = document.getElementById('apiKeyMessage');
    const actionsDiv = document.getElementById('actions');
    const goBackButton = document.getElementById('goBackButton');
    const proceedAnywayButton = document.getElementById('proceedAnywayButton');

    let currentTabId = null;
    let currentTabUrl = null;

    /**
     * Loads the API key from local storage and updates the input field.
     * Sets an appropriate message indicating whether the key is set.
     */
    async function loadAndDisplayApiKey() {
        try {
            const { apiKey } = await chrome.storage.local.get('apiKey');
            if (apiKey) {
                apiKeyInput.value = apiKey;
                apiKeyMessageEl.textContent = 'Gemini API Key is configured.';
                apiKeyMessageEl.className = 'api-message success';
            } else {
                apiKeyMessageEl.textContent = 'Gemini API Key required for analysis.';
                apiKeyMessageEl.className = 'api-message error';
            }
        } catch (error) {
            console.error(TRINETRA_POPUP_LOG_PREFIX, "Error loading API key:", error);
            apiKeyMessageEl.textContent = 'Error loading API key.';
            apiKeyMessageEl.className = 'api-message error';
        }
    }

    /**
     * Saves the provided API key to local storage.
     * Triggers a re-analysis if a key is newly added.
     */
    async function saveApiKey() {
        const newApiKey = apiKeyInput.value.trim();
        if (newApiKey) {
            try {
                await chrome.storage.local.set({ apiKey: newApiKey });
                apiKeyMessageEl.textContent = 'Gemini API Key saved successfully!';
                apiKeyMessageEl.className = 'api-message success';
                // If a tab is active, trigger re-analysis as the key might enable it now.
                if (currentTabId) {
                    statusMessageEl.innerHTML = '<span class="status-icon"></span>API key saved. Re-analyzing...';
                    explanationEl.textContent = "";
                    actionsDiv.style.display = 'none';
                    chrome.scripting.executeScript({
                        target: { tabId: currentTabId },
                        files: ['content.js']
                    }).catch(err => console.error(TRINETRA_POPUP_LOG_PREFIX, "Error re-injecting content script after API key save:", err));
                }
            } catch (error) {
                console.error(TRINETRA_POPUP_LOG_PREFIX, "Error saving API key:", error);
                apiKeyMessageEl.textContent = 'Failed to save API Key.';
                apiKeyMessageEl.className = 'api-message error';
            }
        } else {
            apiKeyMessageEl.textContent = 'Please enter a valid Gemini API Key.';
            apiKeyMessageEl.className = 'api-message error';
        }
    }

    /**
     * Clears the API key from local storage.
     * Updates UI to reflect that analysis is disabled.
     */
    async function clearApiKey() {
        try {
            await chrome.storage.local.remove('apiKey');
            apiKeyInput.value = '';
            apiKeyMessageEl.textContent = 'Gemini API Key cleared. Analysis disabled.';
            apiKeyMessageEl.className = 'api-message error';
            statusMessageEl.innerHTML = '<span class="status-icon"></span>API Key cleared. Analysis unavailable.';
            explanationEl.textContent = '';
            actionsDiv.style.display = 'none';
        } catch (error) {
            console.error(TRINETRA_POPUP_LOG_PREFIX, "Error clearing API key:", error);
            apiKeyMessageEl.textContent = 'Failed to clear API Key.';
            apiKeyMessageEl.className = 'api-message error';
        }
    }

    /**
     * Updates the popup UI based on the analysis data received from the background script.
     * @param {object|null} data The analysis data object, or null if no data.
     */
    function updatePopupUI(data) {
        const statusIconEl = statusMessageEl.querySelector('.status-icon');

        if (!data || !data.status) { // Handle cases where data might be incomplete initially
            statusMessageEl.className = 'status-pending';
            if (statusIconEl) statusIconEl.textContent = '···'; // Pending icon
            statusMessageEl.childNodes[1].textContent = ' Awaiting analysis...';
            explanationEl.textContent = 'Trinetra is assessing this page or awaiting data from the background service.';
            actionsDiv.style.display = 'none';
            return;
        }

        currentTabUrl = data.url; // Keep track of the URL this status pertains to

        let statusText = "Status: ";
        let statusClass = "";
        let icon = "";

        switch (data.status) {
            case "SAFE":
                statusText += "Safe";
                statusClass = "status-safe";
                icon = "✅";
                actionsDiv.style.display = 'none';
                break;
            case "SUSPICIOUS":
                statusText += "Suspicious";
                statusClass = "status-suspicious";
                icon = "⚠️";
                actionsDiv.style.display = 'flex';
                break;
            case "DANGEROUS":
                statusText += "Dangerous";
                statusClass = "status-dangerous";
                icon = "❌";
                actionsDiv.style.display = 'flex';
                break;
            case "ERROR":
                statusText += "Error";
                statusClass = "status-error";
                icon = "❗";
                actionsDiv.style.display = 'none';
                break;
            case "PENDING":
            default:
                statusText += "Pending Analysis...";
                statusClass = "status-pending";
                icon = "···";
                actionsDiv.style.display = 'none';
                break;
        }
        statusMessageEl.className = statusClass;
        if (statusIconEl) statusIconEl.textContent = icon;
        statusMessageEl.childNodes[1].textContent = ` ${statusText}`; // Add space after icon
        explanationEl.textContent = data.explanation || "No detailed explanation available.";
    }

    // Event Listeners for UI elements
    saveApiKeyButton.addEventListener('click', saveApiKey);
    clearApiKeyButton.addEventListener('click', clearApiKey);

    goBackButton.addEventListener('click', () => {
        if (currentTabId) {
            chrome.runtime.sendMessage({ type: "GO_BACK_TAB", tabId: currentTabId });
            window.close(); // Close popup after action
        }
    });

    proceedAnywayButton.addEventListener('click', async () => {
        if (currentTabId) {
           const response = await chrome.runtime.sendMessage({ type: "PROCEED_ANYWAY", tabId: currentTabId });
           if (response && response.success && response.newStatus) {
               updatePopupUI(response.newStatus); // Update UI to reflect "proceeded" state
           }
           // Optionally close popup, or leave it open for user to see the change
           // window.close();
        }
    });

    // Listener for messages from the background script (e.g., real-time status updates)
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "UPDATE_POPUP_DATA") {
            // Ensure the update is for the currently displayed tab's URL in the popup
            if (request.data && request.data.url === currentTabUrl) {
                 updatePopupUI(request.data);
            } else if (!currentTabUrl && request.data) { // If popup just opened and currentTabUrl isn't set yet
                updatePopupUI(request.data);
            }
        }
        return true; // Keep message channel open
    });

    // --- Initialization ---
    await loadAndDisplayApiKey();

    // Get current tab info and request its analysis status from background script
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs.length > 0) {
            currentTabId = tabs[0].id;
            currentTabUrl = tabs[0].url; // Initialize currentTabUrl

            if (!currentTabUrl || (!currentTabUrl.startsWith('http:') && !currentTabUrl.startsWith('https://'))) {
                statusMessageEl.innerHTML = '<span class="status-icon"></span>Cannot analyze this page.';
                explanationEl.textContent = "Trinetra analyzes http/https web pages.";
                if (statusMessageEl.querySelector('.status-icon')) statusMessageEl.querySelector('.status-icon').textContent = 'ℹ️';
                return;
            }
            
            const response = await chrome.runtime.sendMessage({ type: "GET_TAB_STATUS", tabId: currentTabId });
            updatePopupUI(response); // Initial UI update with current status

        } else {
            statusMessageEl.innerHTML = '<span class="status-icon"></span>No active tab found.';
            if (statusMessageEl.querySelector('.status-icon')) statusMessageEl.querySelector('.status-icon').textContent = 'ℹ️';
        }
    } catch (error) {
        console.error(TRINETRA_POPUP_LOG_PREFIX, "Error initializing popup:", error);
        statusMessageEl.innerHTML = '<span class="status-icon">❗</span>Error loading status.';
        explanationEl.textContent = "Could not retrieve page status. " + error.message;
    }
});