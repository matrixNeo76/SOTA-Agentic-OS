'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { Lock, Mail, Loader2, ShieldCheck } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('admin@sota-os.local')
  const [password, setPassword] = useState('admin123')
  const [loading, setLoading] = useState(false)

  // Check if already authenticated
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a2e] via-[#1a1a4e] to-[#0a0a2e] p-4">
      <Card className="w-full max-w-md bg-card/95 backdrop-blur shadow-2xl">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <img src="/logo-sota.png" alt="SOTA" className="size-16 object-contain" />
          </div>
          <CardTitle className="text-xl">SOTA Agentic OS</CardTitle>
          <CardDescription>Accedi alla plancia di comando</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <Mail className="size-3" /> Email
            </Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              className="bg-background"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <Lock className="size-3" /> Password
            </Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              className="bg-background"
            />
          </div>
          <Button className="w-full" onClick={login} disabled={loading}>
            {loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <ShieldCheck className="size-4 mr-2" />}
            {loading ? 'Accesso…' : 'Accedi'}
          </Button>
          <div className="text-center text-xs text-muted-foreground pt-2 border-t">
            <p>Default: <code className="font-mono">admin@sota-os.local</code> / <code className="font-mono">admin123</code></p>
            <p className="mt-1">INTELLIGENT · SECURE · AUTONOMOUS</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
