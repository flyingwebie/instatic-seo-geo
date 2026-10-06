import { definePlugin, permissions } from "#instatic-sdk";
import packageInfo from "./package.json";

export default definePlugin({
  id: "instatic.seo-geo",
  name: "SEO & GEO (Unofficial Alpha)",
  version: process.env.INSTATIC_PLUGIN_VERSION || packageInfo.version,
  description:
    "Unofficial alpha: published Markdown, sitemaps, SEO metadata, Schema.org, audits, redirects, and webmaster reports.",
  homepage: "https://github.com/flyingwebie/instatic-seo-geo#readme",
  repository: "https://github.com/flyingwebie/instatic-seo-geo",
  keywords: ["seo", "geo", "markdown", "sitemap", "schema"],
  permissions: [
    permissions.cmsRoutes,
    permissions.cmsRoutesPublic,
    permissions.cmsRoutesSite,
    permissions.cmsPublicationRead,
    permissions.cmsHooks,
    permissions.cmsStorage,
    permissions.cmsSchedule,
    permissions.networkOutbound,
    permissions.adminNavigation,
    permissions.editorCode,
  ],
  networkAllowedHosts: [
    "api.indexnow.org",
    "www.googleapis.com",
    "oauth2.googleapis.com",
    "ssl.bing.com",
  ],
  resources: [
    {
      id: "documents",
      title: "Generated documents",
      fields: [
        { id: "generation", label: "Generation", type: "text", required: true },
        { id: "path", label: "Path", type: "text", required: true },
        { id: "content", label: "Content", type: "longtext", required: true },
      ],
    },
    {
      id: "state",
      title: "Generation state",
      fields: [
        { id: "key", label: "Key", type: "text", required: true },
        { id: "value", label: "Value", type: "longtext", required: true },
      ],
    },
  ],
  settings: [
    {
      id: "siteUrl",
      label: "Website origin",
      type: "url",
      description:
        "The public website origin, for example https://example.com.",
    },
    {
      id: "options",
      label:
        "Page metadata, profiles, collections, translations, and crawler policies (JSON)",
      type: "textarea",
      rows: 12,
      default: "{}",
    },
    {
      id: "llmsEnabled",
      label: "Publish optional llms.txt",
      type: "toggle",
      default: false,
    },
    {
      id: "indexNowEnabled",
      label: "Submit changed and removed URLs to IndexNow",
      type: "toggle",
      default: false,
    },
    {
      id: "indexNowKey",
      label: "IndexNow ownership key (published in its verification file)",
      type: "text",
    },
    {
      id: "googleProperty",
      label: "Search Console property (URL origin or sc-domain)",
      type: "text",
    },
    {
      id: "googleAccessToken",
      label: "Google access token (webmasters.readonly)",
      type: "password",
      secret: true,
    },
    { id: "googleClientId", label: "Google OAuth client ID", type: "text" },
    {
      id: "googleClientSecret",
      label: "Google OAuth client secret",
      type: "password",
      secret: true,
    },
    {
      id: "googleRefreshToken",
      label: "Google OAuth refresh token",
      type: "password",
      secret: true,
    },
    {
      id: "bingApiKey",
      label: "Bing Webmaster API key",
      type: "password",
      secret: true,
    },
  ],
  adminPages: [
    {
      id: "overview",
      title: "SEO & GEO",
      navLabel: "SEO & GEO",
      content: { kind: "app", heading: "SEO & GEO", entry: "admin/index.js" },
    },
  ],
});
