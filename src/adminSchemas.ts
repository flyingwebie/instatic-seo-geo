import { Type } from "@sinclair/typebox";
import { FindingSchema } from "./config";
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
  pages: Type.Array(
    Type.Object({
      path: Type.String(),
      title: Type.String(),
      canonical: Type.String(),
      indexable: Type.Boolean(),
      lastModified: Type.String(),
    }),
  ),
});
export const ProgressSchema = Type.Object({
  done: Type.Boolean(),
  offset: Type.Integer(),
  total: Type.Integer(),
});
export const IndexNowResultSchema = Type.Object({
  enabled: Type.Boolean(),
  submitted: Type.Integer(),
  remaining: Type.Integer(),
  status: Type.Integer(),
});
