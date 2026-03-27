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
  
  // Check for role-based access on agency and partner routes (production only)
  const isAgencyRoute = request.nextUrl.pathname.startsWith('/agency')
  const isPartnerRoute = request.nextUrl.pathname.startsWith('/partner')
  
  if (isAgencyRoute || isPartnerRoute) {
    try {
      const { user, supabase, supabaseResponse } = await createMiddlewareClient(request)
      
      // If no user is logged in, redirect to login
      if (!user) {
        const url = request.nextUrl.clone()
        url.pathname = '/auth/login'
        return NextResponse.redirect(url)
      }
      
      // Get user's role from metadata
      let userRole = user.user_metadata?.role as string | undefined
      
      // If role not in metadata, check the profiles table
      if (!userRole) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
        
        userRole = profile?.role as string | undefined
      }
      
      // If user still doesn't have a role set, they need to complete their profile
      // For now, allow access but they should be prompted to set their role
      if (!userRole) {
        return supabaseResponse
      }
      
      // Check if user is trying to access the wrong portal
      if (isAgencyRoute && userRole === 'partner') {
        // Partner trying to access agency routes - redirect to partner portal
        const url = request.nextUrl.clone()
        url.pathname = '/partner'
        return NextResponse.redirect(url)
      }
      
      if (isPartnerRoute && userRole === 'agency') {
        // Agency trying to access partner routes - redirect to agency portal
        const url = request.nextUrl.clone()
        url.pathname = '/agency'
        return NextResponse.redirect(url)
      }
      
      return supabaseResponse
    } catch (error) {
      // If there's an error checking auth, allow access and let the page handle it
      console.error('Middleware auth error:', error)
      return NextResponse.next()
    }
  }
  
  return NextResponse.next()
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
