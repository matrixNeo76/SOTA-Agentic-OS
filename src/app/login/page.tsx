'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Lock, Mail, Loader2, ArrowRight, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('admin@sota-os.local')
  const [password, setPassword] = useState('admin123')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(d => {
      if (d.authenticated) router.push('/')
    })
  }, [router])

  const login = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', email, password }),
      })
      const d = await r.json()
      if (d.ok) {
        toast.success(`Benvenuto, ${d.user.name || d.user.email}`)
        router.push('/')
      } else {
        toast.error(d.error || 'Login fallito')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel: branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-[#0a0a2e]">
        {/* Decorative circuit pattern */}
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: `radial-gradient(circle at 20% 50%, #00d4ff22 0%, transparent 50%),
                            radial-gradient(circle at 80% 80%, #3a1e6a44 0%, transparent 50%),
                            radial-gradient(circle at 50% 20%, #00d4ff11 0%, transparent 40%)`,
        }} />
        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: `linear-gradient(#00d4ff22 1px, transparent 1px),
                            linear-gradient(90deg, #00d4ff22 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }} />

        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <img src="/logo-sota.png" alt="SOTA" className="size-12 object-contain" />
            <div>
              <div className="text-lg font-bold tracking-tight">SOTA Agentic OS</div>
              <div className="text-[10px] text-white/50 tracking-[0.2em] uppercase">Operating System</div>
            </div>
          </div>

          <div className="space-y-6 max-w-md">
            <h1 className="text-4xl font-bold leading-tight">
              Il sistema operativo<br/>
              <span className="text-[#00d4ff]">per agenti autonomi</span>
            </h1>
            <p className="text-white/60 text-lg leading-relaxed">
              23 fasi operative · kernel transazionale · verifica formale LTL ·
              Lean4 · Sovereign Validator · Tool Ecosystem con ECDSA
            </p>
            <div className="flex gap-3 flex-wrap">
              {['LTL', 'Lean4', 'ERL', 'ESR', 'ACTS', 'ECDSA'].map(tag => (
                <span key={tag} className="px-3 py-1 rounded-full border border-white/20 text-xs font-mono text-white/70">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="text-xs text-white/40 tracking-wider">
            INTELLIGENT · SECURE · AUTONOMOUS
          </div>
        </div>
      </div>

      {/* Right panel: form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <img src="/logo-sota.png" alt="SOTA" className="size-10 object-contain" />
            <div className="text-lg font-bold">SOTA Agentic OS</div>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight">Accedi</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Inserisci le tue credenziali per accedere alla plancia di comando
            </p>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && login()}
                  className="pl-10 h-11"
                  placeholder="admin@sota-os.local"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && login()}
                  className="pl-10 pr-10 h-11"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button
              className="w-full h-11 text-sm font-medium"
              onClick={login}
              disabled={loading}
            >
              {loading ? (
                <><Loader2 className="size-4 mr-2 animate-spin" /> Accesso in corso…</>
              ) : (
                <>Accedi <ArrowRight className="size-4 ml-2" /></>
              )}
            </Button>
          </div>

          <div className="pt-6 border-t text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              Credenziali demo: <code className="font-mono text-foreground/80">admin@sota-os.local</code> / <code className="font-mono text-foreground/80">admin123</code>
            </p>
            <p className="text-[10px] text-muted-foreground/60 tracking-wider">
              INTELLIGENT · SECURE · AUTONOMOUS
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
