import { Type, type Static } from "@sinclair/typebox";
import { FindingSchema } from "./config";
import { AioReportSchema } from "./aio";
export const PageChoicesSchema = Type.Array(
  Type.Object({
    path: Type.String(),
    title: Type.String(),
    kind: Type.String(),
    tableSlug: Type.String(),
  }),
);
export const StatusSchema = Type.Object({
  configured: Type.Boolean(),
  stage: Type.String(),
  total: Type.Integer(),
  generated: Type.Integer(),
  indexable: Type.Integer(),
  pending: Type.Boolean(),
  completedAt: Type.String(),
  findings: Type.Array(FindingSchema),
  suggestions: Type.Array(
    Type.Object({
      from: Type.String(),
      to: Type.String(),
      reason: Type.String(),
    }),
  ),
  siteName: Type.Optional(Type.String()),
  pages: Type.Array(
    Type.Object({
      path: Type.String(),
      title: Type.String(),
      canonical: Type.String(),
      indexable: Type.Boolean(),
      lastModified: Type.String(),
      description: Type.Optional(Type.String()),
      datePublished: Type.Optional(Type.String()),
      section: Type.Optional(Type.String()),
      socialImage: Type.Optional(Type.String()),
      ogImage: Type.Optional(Type.String()),
      aio: Type.Optional(AioReportSchema),
    }),
  ),
});
export const ProgressSchema = Type.Object({
  done: Type.Boolean(),
  offset: Type.Integer(),
  total: Type.Integer(),
  phase: Type.Optional(Type.String()),
  refreshed: Type.Optional(Type.Integer()),
  images: Type.Optional(Type.Integer()),
  imageTotal: Type.Optional(Type.Integer()),
});
export const IndexNowResultSchema = Type.Object({
  enabled: Type.Boolean(),
  submitted: Type.Integer(),
  remaining: Type.Integer(),
  status: Type.Integer(),
});
export const HistoryPointSchema = Type.Object({
  date: Type.String(),
  total: Type.Integer(),
  generated: Type.Integer(),
  indexable: Type.Integer(),
  errors: Type.Integer(),
  warnings: Type.Integer(),
  notices: Type.Integer(),
  aioReviewed: Type.Integer(),
  aioReady: Type.Integer(),
});
export type HistoryPoint = Static<typeof HistoryPointSchema>;
export const HistorySchema = Type.Array(HistoryPointSchema);
