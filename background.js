const LOG = DEV ? (...args) => console.log("[SMS Grades BG]", ...args) : () => {};
const ERR = DEV ? (...args) => console.error("[SMS Grades BG]", ...args) : () => {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "fetchPage") {
    const url = message.url;
    LOG(`Fetching: ${url}`);

    fetch(url, { credentials: "include" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        LOG(`${url}: HTTP ${response.status}`);
        return response.text();
      })
      .then((html) => {
        LOG(`${url}: received ${html.length} chars`);
        sendResponse({ success: true, html });
      })
      .catch((err) => {
        ERR(`${url} error:`, err.message);
        sendResponse({ success: false, error: err.message });
      });

    return true; // keep channel open for async response
  }
});
