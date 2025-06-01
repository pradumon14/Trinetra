/**
 * @file content.js
 * @description This script is injected into web pages to extract relevant data for security analysis.
 * It collects DOM information such as text, HTML structure, scripts, forms, iframes, and links,
 * then sends this data to the background script for processing by the Trinetra AI Web Guardian.
 *
 * @author Pradumon Sahani
 * @version 1.3
 */

// Constants for Trinetra logging
const TRINETRA_LOG_PREFIX = "Trinetra Content:";

/**
 * Extracts comprehensive data from the current web page.
 * This includes URL, HTML source, visible text, script sources,
 * form details, iframe sources, and a sample of external links.
 * @returns {object} An object containing the extracted page data.
 */
function extractPageData() {
    const data = {
        url: window.location.href,
        title: document.title,
        html: document.documentElement.outerHTML,
        visibleText: document.body.innerText,
        scripts: [],
        forms: [],
        iframes: [],
        links: []
    };

    // Extract all script elements with a 'src' attribute
    document.querySelectorAll('script[src]').forEach(script => {
        data.scripts.push(script.src);
    });

    // Extract details from all form elements
    document.querySelectorAll('form').forEach(form => {
        const formDetails = {
            action: form.action,
            method: form.method,
            inputs: []
        };
        form.querySelectorAll('input').forEach(input => {
            formDetails.inputs.push({
                name: input.name,
                type: input.type,
                // Value is intentionally omitted to avoid logging sensitive data
            });
        });
        data.forms.push(formDetails);
    });

    // Extract sources of all iframe elements
    document.querySelectorAll('iframe[src]').forEach(iframe => {
        data.iframes.push(iframe.src);
    });

    // Extract a sample of anchor tags with 'href' attributes, focusing on external links
    // Limiting to the first 20 external links to keep the data payload manageable.
    document.querySelectorAll('a[href]').forEach(link => {
        if (data.links.length < 20 && link.href && (link.href.startsWith('http:') || link.href.startsWith('https://')) && !link.href.startsWith(window.location.origin)) {
            data.links.push(link.href);
        }
    });

    return data;
}

// Main execution block: attempt to extract data and send it to the background script.
try {
    const pageData = extractPageData();
    chrome.runtime.sendMessage({ type: "PAGE_DATA", data: pageData });
    // console.log(TRINETRA_LOG_PREFIX, "Page data sent to background script.");
} catch (error) {
    console.error(TRINETRA_LOG_PREFIX, "Error extracting or sending page data:", error);
}

// Listener for messages from the background script or popup (e.g., navigation commands).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "GO_BACK_PAGE") {
        window.history.back();
        sendResponse({ success: true });
        // console.log(TRINETRA_LOG_PREFIX, "Navigated back on request.");
    }
    return true; // Indicates that sendResponse might be called asynchronously.
});