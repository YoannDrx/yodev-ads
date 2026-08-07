import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'

// Authorization is revalidated at each page, route and Server Action boundary.
const withClerk = clerkMiddleware()

const maintenanceAllowedPaths = ['/maintenance', '/privacy', '/terms', '/api/health', '/api/webhooks/stripe']

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const maintenance = process.env.MAINTENANCE_MODE === '1'
  const allowed = maintenanceAllowedPaths.some(
    (path) => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`),
  )

  if (maintenance && !allowed) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return NextResponse.json(
        { error: 'Ads by Yodev is temporarily in maintenance mode.' },
        { status: 503, headers: { 'Retry-After': '900' } },
      )
    }
    const maintenanceUrl = request.nextUrl.clone()
    maintenanceUrl.pathname = '/maintenance'
    maintenanceUrl.search = ''
    return NextResponse.redirect(maintenanceUrl, 307)
  }

  return withClerk(request, event)
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
