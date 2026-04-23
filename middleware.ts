import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/middleware'

// Check if request is to demo subdomain
function isDemoRequest(request: NextRequest): boolean {
  const hostname = request.headers.get('host') || ''
  return hostname.startsWith('demo.') || hostname === 'demo.withligament.com'
}

// Public paths that don't require auth
const publicPaths = [
  '/',
  '/auth',
  '/legal',
  '/terms',
  '/privacy',
  '/password',
  '/api/password',
  '/pricing',
  '/contact',
]

function isPublicPath(pathname: string): boolean {
  return publicPaths.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

export async function middleware(request: NextRequest) {
  const isDemo = isDemoRequest(request)
  const pathname = request.nextUrl.pathname
  
  // Allow public paths without auth
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }
  
  // Demo site: require user-based demo_access instead of password
  if (isDemo) {
    try {
      const { user, supabase, supabaseResponse } = await createMiddlewareClient(request)
      
      // If no user logged in on demo site, redirect to login
      if (!user) {
        const url = request.nextUrl.clone()
        url.pathname = '/auth/login'
        url.searchParams.set('demo', 'true')
        return NextResponse.redirect(url)
      }
      
      // Check if user has demo_access
      const { data: profile } = await supabase
        .from('profiles')
        .select('demo_access, is_admin, role')
        .eq('id', user.id)
        .single()
      
      // Only allow users with demo_access or is_admin
      if (!profile?.demo_access && !profile?.is_admin) {
        const url = request.nextUrl.clone()
        url.pathname = '/auth/demo-access-denied'
        return NextResponse.redirect(url)
      }
      
      // Demo user has access - allow both agency and partner routes
      return supabaseResponse
    } catch (error) {
      // Auth error on demo - redirect to login
      const url = request.nextUrl.clone()
      url.pathname = '/auth/login'
      return NextResponse.redirect(url)
    }
  }
  
  // Production: protect all non-public app routes.
  const isAgencyRoute = pathname.startsWith('/agency')
  const isPartnerRoute = pathname.startsWith('/partner')
  const isAdminRoute = pathname.startsWith('/admin')

  try {
    const { user, supabase, supabaseResponse } = await createMiddlewareClient(request)

    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/login'
      return NextResponse.redirect(url)
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_admin')
      .eq('id', user.id)
      .single()

    const userRole = (user.user_metadata?.role as string | undefined) || (profile?.role as string | undefined)
    const isAdmin = !!profile?.is_admin

    if (isAdminRoute && !isAdmin) {
      const url = request.nextUrl.clone()
      url.pathname = userRole === 'partner' ? '/partner' : '/agency/dashboard'
      return NextResponse.redirect(url)
    }

    if (isAgencyRoute && userRole === 'partner') {
      const url = request.nextUrl.clone()
      url.pathname = '/partner'
      return NextResponse.redirect(url)
    }

    if (isPartnerRoute && userRole === 'agency') {
      const url = request.nextUrl.clone()
      url.pathname = '/agency/dashboard'
      return NextResponse.redirect(url)
    }

    return supabaseResponse
  } catch (error) {
    console.error('Middleware auth error:', error)
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * - api routes (allow direct access to API endpoints)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
