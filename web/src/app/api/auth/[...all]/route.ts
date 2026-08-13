import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth'

const handler = (request: Request) => getAuth().handler(request)

export const { DELETE, GET, PATCH, POST, PUT } = toNextJsHandler(handler)
