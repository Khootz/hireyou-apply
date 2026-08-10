export function ExtensionPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-5">
      <h1 className="text-xl font-semibold text-slate-900">Install the HireYou extension</h1>
      <p className="text-sm text-slate-600">
        The extension detects job postings on the HKUST career board, saves them to your tracker, generates tailored
        documents, and suggests answers on application forms. It is not on the Chrome Web Store yet, so it installs in
        developer mode — takes about a minute:
      </p>
      <ol className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3 text-sm text-slate-700 list-decimal list-inside">
        <li>
          Open <code className="bg-slate-100 px-1.5 py-0.5 rounded">chrome://extensions</code> in a new tab
        </li>
        <li>
          Turn on <strong>Developer mode</strong> (top-right toggle)
        </li>
        <li>
          Click <strong>Load unpacked</strong> and select{' '}
          <code className="bg-slate-100 px-1.5 py-0.5 rounded">Desktop\hireyou-apply\apps\extension\dist</code>
        </li>
        <li>Pin “HireYou Apply” from the puzzle-piece menu, then click its icon to open the side panel</li>
        <li>
          In the panel’s ⚙ settings, paste the API token from your project’s{' '}
          <code className="bg-slate-100 px-1.5 py-0.5 rounded">.env</code> (API_AUTH_TOKEN)
        </li>
        <li>
          Open any posting on the{' '}
          <a className="text-blue-700 hover:underline" href="https://career.hkust.edu.hk/web/job.php" target="_blank" rel="noreferrer">
            HKUST career board
          </a>{' '}
          — the panel picks it up automatically
        </li>
      </ol>
      <p className="text-xs text-slate-400">
        If the extension code changes, run <code className="bg-slate-100 px-1 rounded">npm run build:extension</code> and press
        the refresh icon on the extension card. Chrome Web Store publishing (unlisted) is planned for the HireYou 2.0
        integration.
      </p>
    </div>
  )
}
