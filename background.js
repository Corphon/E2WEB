chrome.runtime.onInstalled.addListener(() => {
  console.log('E2Web form mapper extension installed');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'E2WEB_GET_STATUS') {
    sendResponse({ ok: true, installedAt: Date.now() });
    return false;
  }

  return false;
});
