import { ProfilePage } from './pages/ProfilePage'

export function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center gap-6">
          <span className="font-semibold text-blue-700">HireYou Apply</span>
          <span className="text-sm text-slate-400 cursor-not-allowed" title="Arrives in M3">
            Jobs
          </span>
          <span className="text-sm font-medium text-slate-900 border-b-2 border-blue-700 h-14 leading-[3.5rem]">
            My Resume
          </span>
        </div>
      </nav>
      <ProfilePage />
    </div>
  )
}
