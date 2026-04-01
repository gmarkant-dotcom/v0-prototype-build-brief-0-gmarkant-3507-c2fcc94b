import { NextResponse } from "next/server"
import { cookies } from "next/headers"

/**
 * Public site gate (SITE_PASSWORD). No Supabase session — intentional.
 * Not a substitute for per-user auth on protected API routes.
 */
export async function POST(request: Request) {
  const { password } = await request.json()
  
  const sitePassword = process.env.SITE_PASSWORD
  
  if (!sitePassword) {
    // If no password is set, allow access
    return NextResponse.json({ success: true })
  }
  
  if (password === sitePassword) {
    const cookieStore = await cookies()
    
    // Set a cookie that expires in 7 days
    cookieStore.set("site_auth", "authenticated", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    })
    
    return NextResponse.json({ success: true })
  }
  
  return NextResponse.json({ error: "Invalid password" }, { status: 401 })
}
