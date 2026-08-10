import type { HkustJob } from '@app/shared/extractors/hkust'

// Service worker = per-tab job registry. MV3 workers are killed between
// events, so detected jobs live in chrome.storage.session, not in memory.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

const tabKey = (tabId: number) => `tabjob:${tabId}`

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'hkust-job-detected' && sender.tab?.id !== undefined) {
    chrome.storage.session.set({ [tabKey(sender.tab.id)]: message.job }).then(() => sendResponse({ ok: true }))
    return true
  }
  if (message?.type === 'get-active-job') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(async ([tab]) => {
      if (tab?.id === undefined) return sendResponse({ job: null })
      const stored = await chrome.storage.session.get(tabKey(tab.id))
      sendResponse({ job: (stored[tabKey(tab.id)] as HkustJob | undefined) ?? null })
    })
    return true
  }
  return false
})

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(tabKey(tabId)).catch(() => {})
})
