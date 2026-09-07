import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, UserCircle2, Users } from 'lucide-react';
import { PERSONA_LABELS, usePersonaStore, type Persona } from '@/state/persona';
import { useTeams, useUsers } from '@/lib/queries';
import { Modal, inputCls } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { fuzzyScore, cn } from '@/lib/utils';

/**
 * "View as" is a pure navigation preset — it changes the home route and nothing
 * else. Personal opens the person set under "Who am I"; Team opens the default
 * team set under "My team"; Org opens the org overview. Both identity settings
 * are always editable from the menu, whichever view is active.
 */
export function PersonaSwitcher() {
  const navigate = useNavigate();
  const { persona, email, teamId, setPersona, setEmail, setTeamId, identifyOpen, setIdentifyOpen } =
    usePersonaStore();
  const teams = useTeams().data?.teams;
  const teamName = teamId != null ? teams?.find((t) => t.id === teamId)?.name ?? `team #${teamId}` : null;

  const choose = (p: Persona) => {
    setPersona(p);
    if (p === 'developer') {
      if (email) navigate(`/user/${encodeURIComponent(email)}`);
      else setIdentifyOpen('developer'); // nothing chosen yet — ask, then land there
    } else if (p === 'lead') {
      if (teamId != null) navigate(`/team/${teamId}`);
      else setIdentifyOpen('lead');
    } else {
      navigate('/org');
    }
  };

  const itemCls =
    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent/15';

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-fg"
          >
            <UserCircle2 size={13} />
            {PERSONA_LABELS[persona]}
            <ChevronDown size={11} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="card pop-in z-50 w-60 p-1.5 shadow-xl"
          >
            <div className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-wider text-muted">
              View as
            </div>
            {(Object.keys(PERSONA_LABELS) as Persona[]).map((p) => (
              <DropdownMenu.Item key={p} onSelect={() => choose(p)} className={itemCls}>
                <span className="w-3.5">{persona === p && <Check size={12} />}</span>
                <span className="min-w-0">
                  {PERSONA_LABELS[p]}
                  <span className="block truncate text-[10px] text-muted">
                    {p === 'developer' && (email ?? 'home: my profile')}
                    {p === 'lead' && (teamName ?? 'home: my team')}
                    {p === 'director' && 'home: org overview'}
                  </span>
                </span>
              </DropdownMenu.Item>
            ))}

            <div className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted">
              Identity
            </div>
            <DropdownMenu.Item onSelect={() => setIdentifyOpen('developer')} className={itemCls}>
              <UserCircle2 size={13} className="w-3.5 shrink-0 text-muted" />
              <span className="min-w-0">
                Who am I…
                <span className="block truncate text-[10px] text-muted">{email ?? 'not set'}</span>
              </span>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setIdentifyOpen('lead')} className={itemCls}>
              <Users size={13} className="w-3.5 shrink-0 text-muted" />
              <span className="min-w-0">
                My team…
                <span className="block truncate text-[10px] text-muted">{teamName ?? 'not set'}</span>
              </span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <IdentifyDialog
        mode={identifyOpen}
        onClose={() => setIdentifyOpen(false)}
        onPickUser={(pickedEmail) => {
          setEmail(pickedEmail);
          setIdentifyOpen(false);
          // Only move if that is the view being looked at — changing the
          // setting from the Org or Team view must not yank the page away.
          if (persona === 'developer') navigate(`/user/${encodeURIComponent(pickedEmail)}`);
        }}
        onPickTeam={(id) => {
          setTeamId(id);
          setIdentifyOpen(false);
          if (persona === 'lead') navigate(`/team/${id}`);
        }}
      />
    </>
  );
}

function IdentifyDialog({
  mode,
  onClose,
  onPickUser,
  onPickTeam,
}: {
  mode: false | 'developer' | 'lead';
  onClose: () => void;
  onPickUser: (email: string) => void;
  onPickTeam: (teamId: number) => void;
}) {
  const [query, setQuery] = useState('');
  const usersQ = useUsers();
  const teamsQ = useTeams();
  const { email, teamId } = usePersonaStore();

  const users = useMemo(() => {
    const all = (usersQ.data?.users ?? []).filter((u) => u.actorType === 'user' && u.email);
    if (!query.trim()) return all.slice(0, 12);
    return all
      .map((u) => ({ u, s: fuzzyScore(query, `${u.name} ${u.email ?? ''}`) }))
      .filter((x): x is { u: (typeof all)[number]; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.u);
  }, [usersQ.data, query]);

  return (
    <Modal
      open={mode !== false}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={mode === 'lead' ? 'My team' : 'Who am I'}
      className="w-[min(94vw,440px)]"
    >
      {mode === 'developer' && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted">The person shown when you view as Personal.</p>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your name or email…"
            className={inputCls}
          />
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {usersQ.isLoading && <div className="py-4 text-center text-xs text-muted">Loading people…</div>}
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => u.email && onPickUser(u.email)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent/10',
                  u.email === email && 'bg-accent/10',
                )}
              >
                <Avatar name={u.name} email={u.email} size={26} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{u.name}</span>
                  <span className="block truncate text-[11px] text-muted">{u.email}</span>
                </span>
                {u.email === email && <Check size={14} className="ml-auto shrink-0 text-accent" />}
              </button>
            ))}
            {!usersQ.isLoading && users.length === 0 && (
              <div className="py-4 text-center text-xs text-muted">No people match.</div>
            )}
          </div>
        </div>
      )}
      {mode === 'lead' && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted">The default team shown when you view as Team.</p>
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {teamsQ.isLoading && <div className="py-4 text-center text-xs text-muted">Loading teams…</div>}
            {(teamsQ.data?.teams ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onPickTeam(t.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent/10',
                  t.id === teamId && 'bg-accent/10',
                )}
              >
                <span className="size-2.5 rounded-full" style={{ background: t.color }} />
                <span className="font-medium">{t.name}</span>
                <span className="ml-auto text-[11px] text-muted">{t.memberCount} members</span>
                {t.id === teamId && <Check size={14} className="shrink-0 text-accent" />}
              </button>
            ))}
            {!teamsQ.isLoading && (teamsQ.data?.teams ?? []).length === 0 && (
              <div className="py-4 text-center text-xs text-muted">
                No teams yet — create one under Admin → Manage teams.
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
