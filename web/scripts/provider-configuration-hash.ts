import { optionalProviders, providerConfigurationHash, type OptionalProvider } from '../src/lib/provider-certification'

const provider = process.argv[2]
if (!Object.hasOwn(optionalProviders, provider ?? '')) {
  console.error(`Choose one provider: ${Object.keys(optionalProviders).join(', ')}`)
  process.exit(1)
}
const configuration = optionalProviders[provider as OptionalProvider]
if (!process.env.NEXT_PUBLIC_APP_URL || configuration.required.some((name) => !process.env[name]?.trim())) {
  console.error('Supply the application origin and all required provider credentials through the environment')
  process.exit(1)
}
console.log(JSON.stringify({ provider, configurationHash: providerConfigurationHash(provider as OptionalProvider, process.env) }))
