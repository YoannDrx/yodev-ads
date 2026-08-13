'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createInitialWorkspace } from '@/lib/workspace'

export async function createWorkspace(formData: FormData) {
  try {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      slug: z.string().trim().max(80).default(''),
    }).parse(Object.fromEntries(formData))
    await createInitialWorkspace(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Création impossible.'
    redirect(`/onboarding?error=${encodeURIComponent(message)}`)
  }
  redirect('/settings')
}
