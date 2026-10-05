import { definePlugin, permissions } from '#instatic-sdk'

export default definePlugin({
  id: 'instatic.seo-geo',
  name: 'SEO & GEO',
  version: '0.1.0',
  description: 'Project scaffold for published-content Markdown, sitemaps, SEO metadata, and Schema.org.',
  homepage: 'https://github.com/flyingwebie/instatic-seo-geo#readme',
  repository: 'https://github.com/flyingwebie/instatic-seo-geo',
  keywords: ['seo', 'geo', 'markdown', 'sitemap', 'schema'],
  permissions: [permissions.cmsRoutes],
})
