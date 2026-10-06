import { definePlugin, permissions } from "#instatic-sdk";
import packageInfo from "./package.json";

export default definePlugin({
  id: "instatic.seo-geo",
  name: "SEO, GEO & AIO (Unofficial Alpha)",
  version: process.env.INSTATIC_PLUGIN_VERSION || packageInfo.version,
  description:
    "Unofficial alpha: published Markdown, sitemaps, guided SEO/GEO/AIO setup, Schema.org, audits, redirects, and webmaster reports.",
  homepage: "https://github.com/flyingwebie/instatic-seo-geo#readme",
  repository: "https://github.com/flyingwebie/instatic-seo-geo",
  keywords: [
    "seo",
    "geo",
    "aio",
    "ai-overviews",
    "markdown",
    "sitemap",
    "schema",
  ],
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
      label: "Advanced configuration JSON (optional)",
      type: "textarea",
      rows: 4,
      description:
        "Use the SEO, GEO & AIO admin page for guided fields, toggles and examples. This JSON field is optional for advanced configuration.",
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
      placeholder: "An 8–128 character key: letters, digits and hyphens",
      description:
        "Optional. Use a unique ownership key for this website; the key is published in a verification file.",
    },
    {
      id: "googleProperty",
      label: "Search Console property (URL origin or sc-domain)",
      type: "text",
      placeholder: "sc-domain:example.com or https://www.example.com/",
      description:
        "Optional. Must match a property verified in your Google Search Console account.",
    },
    {
      id: "googleAccessToken",
      label: "Google access token (webmasters.readonly)",
      type: "password",
      secret: true,
      placeholder: "Optional — leave blank when not using this integration",
    },
    {
      id: "googleClientId",
      label: "Google OAuth client ID",
      type: "text",
      placeholder: "123456789.apps.googleusercontent.com",
    },
    {
      id: "googleClientSecret",
      label: "Google OAuth client secret",
      type: "password",
      secret: true,
      placeholder: "Optional — leave blank when not using this integration",
    },
    {
      id: "googleRefreshToken",
      label: "Google OAuth refresh token",
      type: "password",
      secret: true,
      placeholder: "Optional — leave blank when not using this integration",
    },
    {
      id: "bingApiKey",
      label: "Bing Webmaster API key",
      type: "password",
      secret: true,
      placeholder: "Optional — leave blank when not using this integration",
    },
  ],
  adminPages: [
    {
      id: "overview",
      title: "SEO, GEO & AIO",
      navLabel: "SEO, GEO & AIO",
      content: {
        kind: "app",
        heading: "SEO, GEO & AIO",
        entry: "admin/index.js",
      },
    },
  ],
});
