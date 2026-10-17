import { Routes, Route, Navigate } from 'react-router'
import Login from './pages/Login'
import Browser from './pages/Browser'
import { Toaster } from '@/components/ui/sonner'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Browser />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster richColors position="top-center" />
    </>
  )
}
