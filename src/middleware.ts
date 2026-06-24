import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/share/', '/api/auth', '/api/health', '/api/mcp']
const STATIC_PATTERNS = ['/_next/', '/favicon.ico', '/logo-transparent.png', '/avatar.png', '/robots.txt', '/sitemap.xml']

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p))) return true
  if (STATIC_PATTERNS.some(p => pathname.startsWith(p))) return true
  return false
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (isPublic(pathname)) return NextResponse.next()
  const sessionToken = req.cookies.get('sota_session')?.value
  if (!sessionToken) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('next', pathname + (req.nextUrl.search || ''))
    return NextResponse.redirect(loginUrl)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo-transparent.png|avatar.png).*)'],
}
