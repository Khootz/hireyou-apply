import { extractHkustJobDetail } from '@app/shared/extractors/hkust'

// Runs on career.hkust.edu.hk/web/job_detail.php pages. The board is
// server-rendered PHP (no SPA navigation), so one extraction at
// document_idle per page load is sufficient.
const job = extractHkustJobDetail(document, window.location.href)
if (job) {
  chrome.runtime.sendMessage({ type: 'hkust-job-detected', job }).catch(() => {})
}
