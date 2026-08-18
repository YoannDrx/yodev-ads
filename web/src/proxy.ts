import { NextResponse, type NextRequest } from 'next/server'

// Authentication and authorization are revalidated at every page, route and
// Server Action boundary. The proxy owns maintenance routing and per-request CSP.
const maintenanceAllowedPaths = [
  '/maintenance', '/legal', '/privacy', '/terms', '/cookies', '/subprocessors',
  '/dpa', '/withdrawal', '/status', '/api/health', '/api/webhooks/stripe',
  '/api/webhooks/yodev-mail', '/api/auth', '/api/internal/release-readiness',
  '/api/cron/scheduler',
]

function contentSecurityPolicy(nonce: string) {
  const development = process.env.NODE_ENV !== 'production'
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.vercel-insights.com https://vitals.vercel-insights.com",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

export default function proxy(request: NextRequest) {
  const maintenance = process.env.MAINTENANCE_MODE === '1'
  const allowed = maintenanceAllowedPaths.some((path) => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`))
  if (maintenance && !allowed) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return NextResponse.json({ error: 'Ads by Yodev is temporarily in maintenance mode.' }, { status: 503, headers: { 'Retry-After': '900' } })
    }
    const maintenanceUrl = request.nextUrl.clone()
    maintenanceUrl.pathname = '/maintenance'
    maintenanceUrl.search = ''
    return NextResponse.redirect(maintenanceUrl, 307)
  }

  const nonce = crypto.randomUUID().replaceAll('-', '')
  const csp = contentSecurityPolicy(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-yodev-pathname', request.nextUrl.pathname)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
