import { describe, expect, it } from 'vitest'
import { parseGoogleAdsFailure } from '@/lib/google-ads'

describe('Google Ads failure parser', () => {
  it('surfaces the actionable error code and field path', () => {
    const failure = parseGoogleAdsFailure({
      error: {
        message: 'Request contains an invalid argument.',
        details: [
          {
            requestId: 'request-from-body',
            errors: [
              {
                errorCode: { requestError: 'RESOURCE_NAME_MISSING' },
                message: 'Resource name is missing.',
                location: {
                  fieldPathElements: [
                    { fieldName: 'operations', index: 0 },
                    { fieldName: 'update' },
                    { fieldName: 'resource_name' },
                  ],
                },
              },
            ],
          },
        ],
      },
    })

    expect(failure).toEqual({
      message:
        '[requestError.RESOURCE_NAME_MISSING · operations[0].update.resource_name] Resource name is missing.',
      requestId: 'request-from-body',
    })
  })

  it('falls back to the top-level API message', () => {
    expect(parseGoogleAdsFailure({ error: { message: 'Unauthorized' } })).toEqual({
      message: 'Unauthorized',
      requestId: null,
    })
  })
})
