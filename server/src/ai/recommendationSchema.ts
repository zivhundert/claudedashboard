/**
 * The coach's output contract, twice: a JSON Schema for the provider's
 * structured-output mode (must be a strict subset: every property required,
 * additionalProperties false) and a zod schema that validates whatever comes
 * back — structured or free text — before it reaches the sanitizer.
 */
import { SCORE_AXES, type RecommendationsPayload } from '@dash/shared';
import { z } from 'zod';

const AXES = [...SCORE_AXES] as [string, ...string[]];

const strength = z.object({
  title: z.string().min(1).max(200),
  why: z.string().min(1).max(1000),
  evidence: z.array(z.string().max(120)).max(20).default([]),
});

const recommendation = z.object({
  id: z.string().max(120).default(''),
  title: z.string().min(1).max(200),
  why: z.string().min(1).max(1000),
  tryThis: z.string().min(1).max(1000),
  expectedEffect: z.object({
    axis: z.enum(AXES),
    note: z.string().max(400).default(''),
  }),
  evidence: z.array(z.string().max(120)).max(20).default([]),
});

export const RecommendationsPayloadSchema = z.object({
  standing: z.string().min(1).max(1200),
  dataThin: z.boolean().default(false),
  strengths: z.array(strength).max(10).default([]),
  recommendations: z.array(recommendation).max(12).default([]),
});

export function parsePayload(raw: unknown): RecommendationsPayload {
  const p = RecommendationsPayloadSchema.parse(raw);
  return {
    standing: p.standing,
    dataThin: p.dataThin,
    strengths: p.strengths,
    recommendations: p.recommendations.map((r) => ({
      ...r,
      expectedEffect: { axis: r.expectedEffect.axis as RecommendationsPayload['recommendations'][number]['expectedEffect']['axis'], note: r.expectedEffect.note },
    })),
  };
}

/** Strict JSON Schema for `output_config.format` (structured outputs). */
export const RECOMMENDATIONS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['standing', 'dataThin', 'strengths', 'recommendations'],
  properties: {
    standing: { type: 'string' },
    dataThin: { type: 'boolean' },
    strengths: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why', 'evidence'],
        properties: {
          title: { type: 'string' },
          why: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'why', 'tryThis', 'expectedEffect', 'evidence'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          why: { type: 'string' },
          tryThis: { type: 'string' },
          expectedEffect: {
            type: 'object',
            additionalProperties: false,
            required: ['axis', 'note'],
            properties: {
              axis: { type: 'string', enum: [...SCORE_AXES] },
              note: { type: 'string' },
            },
          },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;
