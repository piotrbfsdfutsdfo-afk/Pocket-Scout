/**
 * Pocket Scout Time - Background Service Worker
 * Handles Chrome Storage API for RL Agent persistence
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_RL_STATE') {
    chrome.storage.local.set({ 'PS_RL_STATE': message.data }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (message.type === 'LOAD_RL_STATE') {
    chrome.storage.local.get(['PS_RL_STATE'], (result) => {
      sendResponse({ data: result.PS_RL_STATE || null });
    });
    return true;
  }
  
  if (message.type === 'SAVE_METRICS') {
    chrome.storage.local.set({ 'PS_METRICS': message.data }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (message.type === 'LOAD_METRICS') {
    chrome.storage.local.get(['PS_METRICS'], (result) => {
      sendResponse({ data: result.PS_METRICS || null });
    });
    return true;
  }
  
  return false;
});

