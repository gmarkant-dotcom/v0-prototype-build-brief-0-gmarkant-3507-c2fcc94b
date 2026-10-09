import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/middleware'
import { resolveAgencyGate } from '@/lib/entitlements'
import { isEntitlementEscapeRoute } from '@/lib/entitlement-escape'

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
  '/api/partner/rfps/claim',
  '/api/partner/partnerships/claim',
  '/pricing',
  '/contact',
  '/rfp',
  '/faq',
]

function isPublicPath(pathname: string): boolean {
  return publicPaths.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

function buildAuthRedirect(request: NextRequest, targetPath: "/auth/login" | "/auth/sign-up") {
  const url = request.nextUrl.clone()
  const originalPath = `${request.nextUrl.pathname}${request.nextUrl.search}`
  const originalParams = request.nextUrl.searchParams

  url.pathname = targetPath
  url.search = ""

  const passthrough = ["invite", "email", "nda", "scope", "agency", "next"]
  for (const key of passthrough) {
    const value = originalParams.get(key)
    if (value) url.searchParams.set(key, value)
  }
  if (!url.searchParams.get("next")) {
    url.searchParams.set("next", originalPath)
  }
  return url
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
        const url = buildAuthRedirect(request, "/auth/login")
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
      const url = buildAuthRedirect(request, "/auth/login")
      return NextResponse.redirect(url)
    }
  }
  
  // Production: protect all non-public app routes.
  // Boundary-checked, so /agency-access (the upgrade screen) is not itself an agency route.
  const isAgencyRoute = pathname === '/agency' || pathname.startsWith('/agency/')
  const isPartnerRoute = pathname.startsWith('/partner')
  const isAdminRoute = pathname.startsWith('/admin')

  try {
    const { user, supabase, supabaseResponse } = await createMiddlewareClient(request)

    if (!user) {
      const url = buildAuthRedirect(request, "/auth/login")
      return NextResponse.redirect(url)
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, active_role, secondary_role, is_admin')
      .eq('id', user.id)
      .single()

    // active_role is the current portal the user is operating in.
    // Fall back to role for users created before migration 047.
    const activeRole = (profile?.active_role as string | undefined) || (profile?.role as string | undefined) || (user.user_metadata?.role as string | undefined)
    const isAdmin = !!profile?.is_admin

    if (isAdminRoute && !isAdmin) {
      const url = request.nextUrl.clone()
      url.pathname = activeRole === 'partner' ? '/partner' : '/agency/dashboard'
      return NextResponse.redirect(url)
    }

    // G1 (owner ruling, 2026-10-09): /agency requires the ACTIVE organization to be a paid
    // lead agency. The same resolver the API routes call; no role column decides it. A
    // refused caller gets the upgrade screen (a rewrite, so the URL is kept). The one
    // exemption is the billing page, where the client wall still applies R6 (owner/admin of
    // the organization only). API routes are not matched here and gate themselves.
    if (isAgencyRoute) {
      const gate = await resolveAgencyGate(user.id, supabase)
      if (!gate.entitled && !isEntitlementEscapeRoute(pathname)) {
        const url = request.nextUrl.clone()
        url.pathname = '/agency-access'
        url.search = ''
        url.searchParams.set('reason', gate.fault ? 'unavailable' : gate.gate)
        return NextResponse.rewrite(url)
      }
    }

    // Portal PREFERENCE routing, unchanged in shape: active_role chooses which side an entitled
    // dual-role user lands on. It grants nothing; the gate above already ran for /agency.
    if (isAgencyRoute && activeRole === 'partner') {
      const url = request.nextUrl.clone()
      url.pathname = '/partner'
      return NextResponse.redirect(url)
    }

    if (isPartnerRoute && activeRole === 'agency') {
      // Only bounce to /agency when the agency side would admit them; otherwise a caller left
      // with active_role 'agency' and no entitlement could reach neither portal.
      const gate = await resolveAgencyGate(user.id, supabase)
      if (gate.entitled) {
        const url = request.nextUrl.clone()
        url.pathname = '/agency/dashboard'
        return NextResponse.redirect(url)
      }
    }

    return supabaseResponse
  } catch (error) {
    console.error('Middleware auth error:', error)
    const url = buildAuthRedirect(request, "/auth/login")
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
