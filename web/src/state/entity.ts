import { create } from 'zustand';
import type { EntityKind } from '@dash/shared';

export interface EntityTarget {
  kind: EntityKind;
  name: string;
}

interface EntityState {
  /** the entity whose detail drawer is open, if any */
  target: EntityTarget | null;
  /** breadcrumb of where we came from — navigating related entities pushes here */
  trail: EntityTarget[];
  open: (kind: EntityKind, name: string) => void;
  back: () => void;
  close: () => void;
}

/** One drawer, mounted once in the shell; any name anywhere can open it. */
export const useEntityStore = create<EntityState>()((set) => ({
  target: null,
  trail: [],
  open: (kind, name) =>
    set((s) => ({
      target: { kind, name },
      trail: s.target && (s.target.kind !== kind || s.target.name !== name) ? [...s.trail, s.target] : s.trail,
    })),
  back: () =>
    set((s) => {
      const prev = s.trail[s.trail.length - 1];
      return prev ? { target: prev, trail: s.trail.slice(0, -1) } : { target: null, trail: [] };
    }),
  close: () => set({ target: null, trail: [] }),
}));

export const ENTITY_LABELS: Record<EntityKind, string> = {
  skill: 'Skill',
  agent: 'Subagent',
  tool: 'Tool',
  mcp: 'MCP server',
  plugin: 'Plugin',
};
