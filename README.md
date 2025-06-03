# Trinetra: AI Web Guardian - Chrome Extension

**Developed by Pradumon Sahani**

Trinetra (त्रिनेत्र - "The Third Eye") is an advanced Chrome browser extension designed to significantly enhance your online security. It monitors websites in real-time, meticulously analyzing their content and behavior using Google's powerful **Gemini 1.5 Flash** AI model. Trinetra acts as your vigilant third eye, warning you if a site appears to be involved in phishing, distributing malware, or engaging in other suspicious activities.

## 🔐 Purpose

The core mission of Trinetra is to protect users by:
-   Performing deep analysis of various website components: URL structure, page title, visible text, key HTML elements (forms, scripts, head content), iframe sources, and external link patterns.
-   Leveraging the sophisticated analytical capabilities of Google Gemini 1.5 Flash for rapid and accurate threat detection.
-   Providing clear, actionable alerts via a browser popup, detailing the nature of potential threats.
-   Empowering users by requiring them to provide their own Google Gemini API key, ensuring transparency and control over API interactions and costs.

## 🔧 Core Functionalities

1.  **Intelligent Content Extraction**: `content.js` precisely extracts vital page elements necessary for a comprehensive security assessment.
2.  **Network Activity Monitoring**: Uses `chrome.webRequest` to log certain network activities (e.g., cross-domain POSTs, redirects), which can serve as additional indicators for analysis or future heuristic development.
3.  **Proactive File Download Scanning**: `chrome.downloads.onCreated` is used to issue warnings for downloads of file types commonly associated with malware (e.g., `.exe`, `.js`, `.docm`).
4.  **Gemini 1.5 Flash Powered AI Analysis**:
    *   Collected page data is structured into a concise JSON summary, optimized for the AI.
    *   A highly specific and engineered prompt is sent to the Google Gemini API (utilizing the `gemini-1.5-flash-latest` model).
    *   Trinetra AI (the persona given to the model) is instructed to act as an expert cybersecurity analyst, focusing on phishing, malware, deceptive practices, and technical red flags.
    *   The AI returns a structured JSON response containing:
        *   `status`: SAFE, SUSPICIOUS, or DANGEROUS.
        *   `explanation`: A concise rationale for the classification.
        *   `confidence_score`: The AI's confidence in its assessment.
        *   `primary_threat_type`: Categorization of the main threat if applicable.
5.  **Intuitive User Interface (Google Aesthetic)**:
    *   The browser action popup, styled with a Google-inspired design, clearly displays Trinetra's assessment (✅ Safe, ⚠️ Suspicious, ❌ Dangerous) along with the AI's explanation.
    *   Provides [Go Back] and [Proceed Anyway] options for sites flagged as SUSPICIOUS or DANGEROUS.
6.  **User-Managed API Key**:
    *   Users **must** enter their personal Google Gemini API key via the popup for Trinetra to function. This is a one-time setup.
    *   The API key is stored securely using `chrome.storage.local` on the user's device.

## ⚙️ Setup Instructions

### 1. Obtain a Google Gemini API Key

1.  Navigate to [Google AI Studio](https://aistudio.google.com/app).
2.  Sign in with your Google account. If you don't have an API key, click on "Get API key" and follow the prompts to create one (usually "Create API key in new project").
3.  Copy the generated API key. **Store this key securely.**
    *Note: Usage of the Gemini API is subject to Google's terms and pricing. While `gemini-1.5-flash-latest` is designed for efficiency, monitor your usage in your Google Cloud project.*

### 2. Install Trinetra in Chrome

1.  Download the **[Trinetra.zip](https://github.com/user-attachments/files/20548982/Trinetra.zip)** file.
2.  **Unzip** the `Trinetra.zip` file into a dedicated folder on your computer (e.g., `Trinetra_Extension`).
3.  Open Google Chrome and navigate to `chrome://extensions`.
4.  Enable **Developer mode** using the toggle switch (usually in the top-right corner).
5.  Click the **Load unpacked** button.
6.  Select the folder where you unzipped the Trinetra extension files (e.g., select the `Trinetra_Extension` folder, which contains the `manifest.json` file and other extension files).
7.  "Trinetra: AI Web Guardian" should now appear in your list of extensions and its icon in your Chrome toolbar.

### 3. Configure and Use Trinetra

1.  Click on the Trinetra extension icon in your Chrome toolbar.
2.  The popup will appear. In the "Gemini API Key" section, paste your copied Gemini API key into the input field.
3.  Click **Save Key**. A confirmation message will appear.
4.  Trinetra will now automatically analyze web pages as you browse. When you visit a new page, it collects data and sends it to Gemini for assessment.
5.  Click the Trinetra icon anytime to see the current page's status and the AI's detailed explanation.
6.  System notifications will also alert you to DANGEROUS and SUSPICIOUS sites.

## 📝 Technical Details

*   **Manifest V3**: Built on the latest Chrome extension platform for enhanced security and performance.
*   **AI Model**: Exclusively uses `gemini-1.5-flash-latest` via the Google Generative Language API.
*   **Prompt Engineering**: The prompt in `background.js` is meticulously crafted to guide the Gemini model for effective cybersecurity analysis and to request a reliable JSON output.
*   **Data Handling**: Page content sent to Gemini is truncated (`MAX_DATA_PAYLOAD_CHARS` in `background.js`) to optimize for API token limits, cost, and latency.
*   **Whitelisting**: A predefined list of known safe domains bypasses AI analysis to improve efficiency and reduce unnecessary API calls.
*   **Analysis Caching**: Results from AI analysis are cached for a short duration (3 minutes) to reduce redundant API calls for recently or re-visited pages, improving performance and minimizing API usage.
*   **"Proceed Anyway" Session Memory**: If a user chooses to "Proceed Anyway" to a site flagged as suspicious or dangerous, Trinetra remembers this choice for that specific URL for the duration of the current browsing session, marking it as safe temporarily.

## 🛡️ Limitations & Disclaimers

*   **AI is a Tool, Not a Panacea**: AI analysis, while powerful, provides a probabilistic assessment. It is not infallible and can occasionally produce false positives or false negatives. Always exercise your own judgment and critical thinking when browsing.
*   **API Costs & Quotas**: You are solely responsible for any costs incurred through the use of your Gemini API key. Monitor your API usage via your Google Cloud Console.
*   **Performance Considerations**: Real-time page analysis involves data extraction and API communication, which may introduce minor latency on page loads, especially on slower connections or complex pages.
*   **Data Privacy**: Trinetra sends page URLs and specific, truncated snippets of page content to the Google Gemini API using **your** provided API key. No data is sent to any other third-party server by the Trinetra extension itself. Please review Google's Gemini API data usage and privacy policies.
*   **Experimental Software**: Trinetra is a sophisticated proof-of-concept developed by Pradumon Sahani. It should be considered experimental software. Use with discretion and understanding of its capabilities and limitations.

---
Trinetra aims to be a powerful ally in your digital safety. Developed by Pradumon Sahani. 

[view whitepaper](https://github.com/pradumon14/Trinetra/blob/main/Other/Whitepaper.pdf)
