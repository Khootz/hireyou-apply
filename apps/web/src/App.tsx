import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { api } from './api'
import { ExtensionPage } from './pages/ExtensionPage'
import { JobDetailPage } from './pages/JobDetailPage'
import { JobsPage } from './pages/JobsPage'
import { ProfilePage } from './pages/ProfilePage'

const navLink = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1.5 text-sm rounded-lg px-3 py-1.5 ${
    isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:text-slate-900'
  }`

export function App() {
  const [initials, setInitials] = useState('·')

  useEffect(() => {
    api
      .getProfile()
      .then((p) => {
        const parts = p.contact.full_name.replace(/,/g, '').split(/\s+/).filter(Boolean)
        if (parts.length > 0) setInitials((parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase())
      })
      .catch(() => {})
  }, [])

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <nav className="bg-white border-b border-slate-200">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-5">
            <span className="font-bold text-blue-700 text-lg tracking-tight">HireYou</span>
            <NavLink to="/jobs" className={navLink}>
              <span>💼</span> Jobs
            </NavLink>
            <NavLink to="/resume" className={navLink}>
              <span>📄</span> My Resume
            </NavLink>
            <NavLink to="/extension" className={navLink}>
              Install Extension <span className="text-xs">↗</span>
            </NavLink>
            <div className="ml-auto w-8 h-8 rounded-full bg-blue-700 text-white text-xs font-semibold flex items-center justify-center">
              {initials}
            </div>
          </div>
        </nav>
        <Routes>
          <Route path="/" element={<Navigate to="/jobs" replace />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/resume" element={<ProfilePage />} />
          <Route path="/extension" element={<ExtensionPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
