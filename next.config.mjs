let userConfig = undefined
try {
  userConfig = await import('./v0-user-next.config')
} catch (e) {
  // ignore error
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Was true, which hid real type errors. The tree typechecks clean now.
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
  },
  webpack: (config, { webpack }) => {
    // RainbowKit imports wagmi's whole connectors barrel, which drags in
    // Coinbase's baseAccount -> @coinbase/cdp-sdk -> the @x402/* payment
    // packages. Those are optional dependencies that do not resolve, and
    // module resolution runs before tree-shaking can drop them. Nothing here
    // uses Coinbase Smart Wallet or x402 payments.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }))
    return config
  },
}

mergeConfig(nextConfig, userConfig)

function mergeConfig(nextConfig, userConfig) {
  if (!userConfig) {
    return
  }

  for (const key in userConfig) {
    if (
      typeof nextConfig[key] === 'object' &&
      !Array.isArray(nextConfig[key])
    ) {
      nextConfig[key] = {
        ...nextConfig[key],
        ...userConfig[key],
      }
    } else {
      nextConfig[key] = userConfig[key]
    }
  }
}

export default nextConfig
