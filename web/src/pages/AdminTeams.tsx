import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { COUNTRIES, countryFlag, countryName, type TeamDto, type UserDto } from '@dash/shared';
import {
  useCreateTeam,
  useDeleteTeam,
  useSetUserCountry,
  useSetUserTeam,
  useTeams,
  useUpdateTeam,
  useUsers,
} from '@/lib/queries';
import { toast } from '@/state/toast';
import { Avatar } from '@/components/Avatar';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/Skeleton';
import { Button, Field, inputCls, Modal } from '@/components/ui';
import { cn } from '@/lib/utils';

const SWATCHES = [
  '#d97757', '#7c6aef', '#0ea5e9', '#10b981', '#f59e0b',
  '#ec4899', '#14b8a6', '#8b5cf6', '#ef4444', '#84cc16',
];

interface TeamForm {
  name: string;
  color: string;
  leadUserId: number | null;
}

export default function AdminTeams() {
  const teamsQ = useTeams();
  const usersQ = useUsers();
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();
  const setUserTeam = useSetUserTeam();
  const setUserCountry = useSetUserCountry();

  const [editing, setEditing] = useState<TeamDto | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TeamDto | null>(null);

  const users = useMemo(
    () => (usersQ.data?.users ?? []).filter((u) => u.actorType === 'user'),
    [usersQ.data],
  );
  const teams = teamsQ.data?.teams ?? [];
  const unassigned = users.filter((u) => u.teamId === null);
  const byTeam = useMemo(() => {
    const map = new Map<number, UserDto[]>();
    for (const u of users) {
      if (u.teamId === null) continue;
      const arr = map.get(u.teamId);
      if (arr) arr.push(u);
      else map.set(u.teamId, [u]);
    }
    return map;
  }, [users]);

  const move = (user: UserDto, teamId: number | null) => {
    setUserTeam.mutate(
      { userId: user.id, teamId },
      {
        onSuccess: () =>
          toast(
            `${user.name} → ${teamId === null ? 'Unassigned' : (teams.find((t) => t.id === teamId)?.name ?? 'team')}`,
            'success',
          ),
        onError: (e) => toast('Could not move user', 'error', e instanceof Error ? e.message : undefined),
      },
    );
  };

  const locate = (user: UserDto, country: string | null) => {
    setUserCountry.mutate(
      { userId: user.id, country },
      {
        onSuccess: () =>
          toast(
            country === null
              ? `${user.name}: location cleared`
              : `${user.name} → ${countryFlag(country) ?? ''} ${countryName(country) ?? country}`,
            'success',
          ),
        onError: (e) => toast('Could not set location', 'error', e instanceof Error ? e.message : undefined),
      },
    );
  };
  const rowBusy = setUserTeam.isPending || setUserCountry.isPending;

  if (teamsQ.isLoading || usersQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }
  if (teamsQ.error) return <ErrorCard error={teamsQ.error} onRetry={() => void teamsQ.refetch()} />;
  if (usersQ.error) return <ErrorCard error={usersQ.error} onRetry={() => void usersQ.refetch()} />;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Manage teams</h1>
          <p className="mt-0.5 text-xs text-muted">
            Create teams, pick a color and a lead, and place people with the dropdowns — team on the right, location
            (shown as a flag on the leaderboard) beside it.
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={13} /> New team
        </Button>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* Unassigned pane */}
        <section className="card p-4">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Users size={14} className="text-muted" /> Unassigned
            <span className="rounded-full bg-fg/10 px-1.5 text-[11px] text-muted">{unassigned.length}</span>
          </h2>
          <p className="mb-3 text-[11px] text-muted">People without a team, including API-key-only rostered users.</p>
          <div className="max-h-[28rem] space-y-1 overflow-y-auto">
            {unassigned.length === 0 && (
              <div className="py-6 text-center text-xs text-muted">Everyone is assigned 🎉</div>
            )}
            {unassigned.map((u) => (
              <UserRow key={u.id} user={u} teams={teams} onMove={move} onLocate={locate} busy={rowBusy} />
            ))}
          </div>
        </section>

        {/* Teams pane */}
        <div className="space-y-4">
          {teams.length === 0 && (
            <div className="card p-8 text-center text-sm text-muted">
              No teams yet — create your first one.
            </div>
          )}
          {teams.map((team) => {
            const members = byTeam.get(team.id) ?? [];
            const lead = users.find((u) => u.id === team.leadUserId);
            return (
              <section key={team.id} className="card p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: team.color }} />
                  <h3 className="text-sm font-semibold">{team.name}</h3>
                  <span className="rounded-full bg-fg/10 px-1.5 text-[11px] text-muted">{members.length}</span>
                  {lead && <span className="text-[11px] text-muted">lead: {lead.name}</span>}
                  <span className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" onClick={() => setEditing(team)} title="Edit team">
                      <Pencil size={13} />
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(team)} title="Delete team">
                      <Trash2 size={13} className="text-risk" />
                    </Button>
                  </span>
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {members.length === 0 && (
                    <div className="py-3 text-center text-[11px] text-muted">No members yet.</div>
                  )}
                  {members.map((u) => (
                    <UserRow key={u.id} user={u} teams={teams} onMove={move} onLocate={locate} busy={rowBusy} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* Create / edit dialog */}
      {editing !== null && (
        <TeamDialog
          team={editing === 'new' ? null : editing}
          users={users}
          busy={createTeam.isPending || updateTeam.isPending}
          onClose={() => setEditing(null)}
          onSave={(form) => {
            if (editing === 'new') {
              createTeam.mutate(form, {
                onSuccess: () => {
                  toast(`Team "${form.name}" created`, 'success');
                  setEditing(null);
                },
                onError: (e) => toast('Could not create team', 'error', e instanceof Error ? e.message : undefined),
              });
            } else {
              updateTeam.mutate(
                { id: editing.id, ...form },
                {
                  onSuccess: () => {
                    toast(`Team "${form.name}" updated`, 'success');
                    setEditing(null);
                  },
                  onError: (e) => toast('Could not update team', 'error', e instanceof Error ? e.message : undefined),
                },
              );
            }
          }}
        />
      )}

      {/* Delete confirm */}
      <Modal
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={`Delete "${confirmDelete?.name ?? ''}"?`}
        className="w-[min(94vw,400px)]"
      >
        <p className="text-xs text-muted">
          Members become unassigned; no usage data is lost. This can't be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={deleteTeam.isPending}
            onClick={() => {
              if (!confirmDelete) return;
              deleteTeam.mutate(confirmDelete.id, {
                onSuccess: () => {
                  toast(`Team "${confirmDelete.name}" deleted`, 'success');
                  setConfirmDelete(null);
                },
                onError: (e) => toast('Could not delete team', 'error', e instanceof Error ? e.message : undefined),
              });
            }}
          >
            <Trash2 size={12} /> Delete team
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function UserRow({
  user,
  teams,
  onMove,
  onLocate,
  busy,
}: {
  user: UserDto;
  teams: TeamDto[];
  onMove: (user: UserDto, teamId: number | null) => void;
  onLocate: (user: UserDto, country: string | null) => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-fg/[0.03]">
      <Avatar name={user.name} email={user.email} size={24} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{user.name}</span>
        <span className="block truncate text-[10.5px] text-muted">
          {user.email ?? user.apiKeyName}
          {user.role ? ` · ${user.role}` : ''}
        </span>
      </span>
      <select
        value={user.country ?? ''}
        disabled={busy}
        onChange={(e) => onLocate(user, e.target.value === '' ? null : e.target.value)}
        className={cn(inputCls, 'w-32 shrink-0 py-1 text-xs')}
        aria-label={`Set ${user.name}'s location`}
        title="Location — shown as a flag next to the name on the leaderboard"
      >
        <option value="">🌐 Location…</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {countryFlag(c.code)} {c.name}
          </option>
        ))}
      </select>
      <select
        value={user.teamId === null ? '' : String(user.teamId)}
        disabled={busy}
        onChange={(e) => onMove(user, e.target.value === '' ? null : Number(e.target.value))}
        className={cn(inputCls, 'w-36 shrink-0 py-1 text-xs')}
        aria-label={`Move ${user.name} to team`}
      >
        <option value="">Unassigned</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function TeamDialog({
  team,
  users,
  busy,
  onClose,
  onSave,
}: {
  team: TeamDto | null;
  users: UserDto[];
  busy: boolean;
  onClose: () => void;
  onSave: (form: TeamForm) => void;
}) {
  const [name, setName] = useState(team?.name ?? '');
  const [color, setColor] = useState(team?.color ?? SWATCHES[0] ?? '#d97757');
  const [leadUserId, setLeadUserId] = useState<number | null>(team?.leadUserId ?? null);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={team ? `Edit ${team.name}` : 'New team'}
      className="w-[min(94vw,420px)]"
    >
      <div className="space-y-3">
        <Field label="Name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Platform"
            className={inputCls}
          />
        </Field>
        <Field label="Color">
          <div className="flex flex-wrap gap-1.5">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                className={cn(
                  'size-6 rounded-full border-2 transition-transform hover:scale-110',
                  color === c ? 'border-fg' : 'border-transparent',
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>
        <Field label="Team lead (optional)">
          <select
            value={leadUserId === null ? '' : String(leadUserId)}
            onChange={(e) => setLeadUserId(e.target.value === '' ? null : Number(e.target.value))}
            className={inputCls}
          >
            <option value="">— none —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || name.trim().length === 0}
            onClick={() => onSave({ name: name.trim(), color, leadUserId })}
          >
            {team ? 'Save changes' : 'Create team'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
