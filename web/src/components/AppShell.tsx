import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  HeartPulse,
  HelpCircle,
  Lightbulb,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Timer,
  Trophy,
  User,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import { useCapabilities, useSettings } from '@/lib/queries';
import { useThemeStore } from '@/state/theme';
import { usePersonaStore } from '@/state/persona';
import { usePrefsStore } from '@/state/prefs';
import { CommandPalette } from '@/components/CommandPalette';
import { GuideDrawer } from '@/components/GuideDrawer';
import { RangePicker, GranularityControl } from '@/components/RangePicker';
import { SyncPill } from '@/components/SyncPill';
import { PersonaSwitcher } from '@/components/PersonaSwitcher';
import { ReleaseNotesDialog } from '@/components/ReleaseNotesDialog';
import { EntityDetailDrawer } from '@/components/EntityDetailDrawer';
import { Toaster } from '@/components/Toaster';
import { Tip } from '@/components/ui';
import { displayZone, setDisplayZone } from '@/lib/time';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}

/**
 * Main nav, gated by the data-source capability matrix. Unknown capabilities
 * (still loading) count as available so the sidebar doesn't flicker; demo
 * mode's all-true matrix keeps everything visible.
 */
function mainNav(caps: { invoiceCosts: boolean; telemetryPacks: boolean } | undefined): NavItem[] {
  const items: NavItem[] = [
    { to: '/org', label: 'Overview', icon: <BarChart3 size={17} />, end: true },
    { to: '/org/insights', label: 'Insights', icon: <Lightbulb size={17} /> },
    { to: '/org/skills', label: 'Skills', icon: <Sparkles size={17} /> },
  ];
  if (caps?.telemetryPacks !== false) {
    items.push(
      { to: '/org/mcp', label: 'MCP', icon: <Plug size={17} /> },
      { to: '/org/activity', label: 'Activity', icon: <Timer size={17} /> },
      { to: '/org/health', label: 'Health', icon: <HeartPulse size={17} /> },
    );
  }
  if (caps?.invoiceCosts !== false) {
    items.push({ to: '/org/costs', label: 'Costs', icon: <Wallet size={17} /> });
  }
  items.push(
    { to: '/teams', label: 'Teams', icon: <Users size={17} /> },
    { to: '/leaderboard', label: 'Leaderboard', icon: <Trophy size={17} /> },
  );
  return items;
}

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/teams', label: 'Manage teams', icon: <Wrench size={17} /> },
  { to: '/admin/sync', label: 'Sync', icon: <RefreshCw size={17} /> },
  { to: '/admin/settings', label: 'Settings', icon: <Settings size={17} /> },
];

function SideLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const link = (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
          isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-fg/5 hover:text-fg',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <span className="shrink-0">{item.icon}</span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
  return collapsed ? (
    <Tip content={item.label} side="right">
      {link}
    </Tip>
  ) : (
    link
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const collapsed = usePrefsStore((s) => s.sidebarCollapsed);
  const toggleSidebar = usePrefsStore((s) => s.toggleSidebar);
  const { email, setIdentifyOpen } = usePersonaStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const capsData = useCapabilities().data;
  const caps = capsData?.capabilities;
  const version = capsData?.version;
  const nav = useMemo(() => mainNav(caps), [caps]);

  // The server keys its daily tables by ORG_TIMEZONE — every calendar-day
  // comparison in the UI has to agree with it. Set DURING render, not in an
  // effect: the zone is a module global, so an effect would leave the first
  // render (and anything it memoized) on the fallback zone.
  const serverZone = useSettings().data?.displayTimezone;
  setDisplayZone(serverZone);
  const zone = displayZone();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const myProfile = () => {
    if (email) navigate(`/user/${encodeURIComponent(email)}`);
    else setIdentifyOpen('developer');
  };

  const profileActive = email ? location.pathname === `/user/${encodeURIComponent(email)}` : false;

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside
        className={cn(
          'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-card/60 backdrop-blur transition-all',
          collapsed ? 'w-14 px-2' : 'w-52 px-3',
        )}
      >
        <div className={cn('flex h-14 items-center gap-2', collapsed && 'justify-center')}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent2 text-[13px] font-bold text-white">
            C
          </span>
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight">Claude Code Insights</span>
          )}
        </div>

        <nav className="mt-2 space-y-0.5">
          {nav.map((item) => (
            <SideLink key={item.to} item={item} collapsed={collapsed} />
          ))}
        </nav>

        <div className="my-3 border-t border-border" />
        <button
          type="button"
          onClick={myProfile}
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
            profileActive ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-fg/5 hover:text-fg',
            collapsed && 'justify-center px-0',
          )}
        >
          <User size={17} className="shrink-0" />
          {!collapsed && <span>My Profile</span>}
        </button>

        <div className="my-3 border-t border-border" />
        {!collapsed && (
          <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Admin
          </div>
        )}
        <nav className="space-y-0.5">
          {ADMIN_NAV.map((item) => (
            <SideLink key={item.to} item={item} collapsed={collapsed} />
          ))}
        </nav>

        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(
            'mt-auto flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-fg/5 hover:text-fg',
            collapsed && 'justify-center px-0',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          {!collapsed && <span>Collapse</span>}
        </button>

        {/* Running server version (from /api/capabilities) — click for the release notes. */}
        <div className={cn('pb-3 pt-1', collapsed ? 'flex justify-center' : 'px-2.5')}>
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            disabled={!version}
            title="What’s new in this version"
            aria-label="Open release notes"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-border bg-card font-mono text-[11px] tabular-nums text-muted transition-colors hover:border-accent/50 hover:text-fg disabled:opacity-0',
              collapsed ? 'px-1.5 py-1' : 'px-2 py-1',
            )}
          >
            <Sparkles size={11} className="text-accent" aria-hidden="true" />
            {version ? `v${version}` : ''}
            {!collapsed && <span className="font-sans text-[10px] text-muted/80">What’s new</span>}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2.5 border-b border-border bg-bg/80 px-4 backdrop-blur">
          <RangePicker />
          <GranularityControl />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] text-muted transition-colors hover:text-fg"
          >
            <Search size={12} />
            <span className="hidden sm:inline">Search</span>
            <kbd className="rounded border border-border px-1 text-[9px]">⌘K</kbd>
          </button>
          <SyncPill />
          <PersonaSwitcher />
          <Tip content={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="flex size-7 items-center justify-center rounded-lg border border-border bg-card text-muted transition-colors hover:text-fg"
            >
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          </Tip>
          <Tip content="Guide: scores, segments, badges & data notes">
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              aria-label="Open guide"
              className="flex size-7 items-center justify-center rounded-lg border border-border bg-card text-muted transition-colors hover:text-fg"
            >
              <HelpCircle size={13} />
            </button>
          </Tip>
        </header>

        {/* keyed on the zone so the subtree re-derives when it arrives — memos
            that don't depend on it would otherwise keep the fallback's dates */}
        <main className="mx-auto w-full max-w-screen-2xl flex-1 p-4">
          <Outlet key={zone} />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <GuideDrawer open={guideOpen} onOpenChange={setGuideOpen} />
      <ReleaseNotesDialog open={notesOpen} onOpenChange={setNotesOpen} currentVersion={version} />
      <EntityDetailDrawer />
      <Toaster />
    </div>
  );
}
