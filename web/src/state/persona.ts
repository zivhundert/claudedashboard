import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Internal keys are historical ('developer' | 'lead' | 'director') and persisted
 * in localStorage — the user-facing names are Personal / Team / Org.
 */
export type Persona = 'developer' | 'lead' | 'director';

interface PersonaState {
  persona: Persona;
  /** "Who am I": the person shown when viewing as Personal */
  email: string | null;
  /** "My team": the default team shown when viewing as Team */
  teamId: number | null;
  /** transient: the "who are you?" dialog */
  identifyOpen: false | 'developer' | 'lead';
  setPersona: (p: Persona) => void;
  setEmail: (email: string | null) => void;
  setTeamId: (teamId: number | null) => void;
  setIdentifyOpen: (v: false | 'developer' | 'lead') => void;
}

export const usePersonaStore = create<PersonaState>()(
  persist(
    (set) => ({
      persona: 'director',
      email: null,
      teamId: null,
      identifyOpen: false,
      setPersona: (persona) => set({ persona }),
      setEmail: (email) => set({ email }),
      setTeamId: (teamId) => set({ teamId }),
      setIdentifyOpen: (identifyOpen) => set({ identifyOpen }),
    }),
    {
      name: 'dash-persona',
      partialize: (s) => ({ persona: s.persona, email: s.email, teamId: s.teamId }),
    },
  ),
);

export const PERSONA_LABELS: Record<Persona, string> = {
  developer: 'Personal',
  lead: 'Team',
  director: 'Org',
};
