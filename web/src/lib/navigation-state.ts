/** Map nested product views to their owning navigation section without matching path prefixes accidentally. */
export function navigationLinkActive(pathname: string, href: string) {
  const discussion = /^\/discussions\/(tasks|alerts|approvals|support)(?:\/|$)/.exec(pathname)
  const section = discussion ? `/${discussion[1]}` : pathname
  return section === href || section.startsWith(`${href}/`)
}
