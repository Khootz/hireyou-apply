import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { JobDetailPage } from './pages/JobDetailPage'
import { JobsPage } from './pages/JobsPage'
import { ProfilePage } from './pages/ProfilePage'

const navLink = ({ isActive }: { isActive: boolean }) =>
  `text-sm h-14 leading-[3.5rem] border-b-2 ${
    isActive ? 'font-medium text-slate-900 border-blue-700' : 'text-slate-500 border-transparent hover:text-slate-800'
  }`

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <nav className="bg-white border-b border-slate-200">
          <div className="mx-auto max-w-5xl px-4 h-14 flex items-center gap-6">
            <span className="font-semibold text-blue-700">HireYou Apply</span>
            <NavLink to="/jobs" className={navLink}>
              Jobs
            </NavLink>
            <NavLink to="/resume" className={navLink}>
              My Resume
            </NavLink>
          </div>
        </nav>
        <Routes>
          <Route path="/" element={<Navigate to="/jobs" replace />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/resume" element={<ProfilePage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
