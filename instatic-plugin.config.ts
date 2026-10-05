import { definePlugin, permissions } from '#instatic-sdk'
import packageInfo from './package.json'

export default definePlugin({
  id: 'instatic.seo-geo',
  name: 'SEO & GEO (Unofficial Alpha)',
  version: process.env.INSTATIC_PLUGIN_VERSION || packageInfo.version,
  description: 'Unofficial alpha-test scaffold for Markdown, sitemaps, SEO metadata, and Schema.org.',
  homepage: 'https://github.com/flyingwebie/instatic-seo-geo#readme',
  repository: 'https://github.com/flyingwebie/instatic-seo-geo',
  keywords: ['seo', 'geo', 'markdown', 'sitemap', 'schema'],
  permissions: [permissions.cmsRoutes],
})
