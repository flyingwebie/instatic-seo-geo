import type { ServerPluginModule } from '#instatic-sdk'

const plugin: ServerPluginModule = {
  activate(api) {
    api.cms.routes.get('/status', 'plugins.read', () => ({
      pluginId: api.plugin.id,
      version: api.plugin.version,
      official: false,
      channel: 'alpha',
      stage: 'scaffold',
      features: {
        markdown: false,
        sitemap: false,
        structuredData: false,
      },
    }))
  },
}

export default plugin
