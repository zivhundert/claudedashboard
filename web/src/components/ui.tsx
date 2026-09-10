import { type ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Info, X } from 'lucide-react';
import { METRIC_GUIDE } from '@dash/shared';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export function Tip({
  content,
  children,
  side = 'top',
  wide = false,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  wide?: boolean;
}) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>
        <span className="inline-flex cursor-default">{children}</span>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'card pop-in z-50 px-3 py-2 text-xs leading-relaxed shadow-xl',
            wide ? 'max-w-xs' : 'max-w-60',
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Info popover fed by METRIC_GUIDE
// ---------------------------------------------------------------------------

export function InfoPopover({ metricKey, extra }: { metricKey?: string; extra?: ReactNode }) {
  const guide = metricKey ? METRIC_GUIDE[metricKey] : undefined;
  if (!guide && !extra) return null;
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="What is this metric?"
          className="text-muted hover:text-fg -m-1 rounded-full p-1 transition-colors hover:bg-border/40"
        >
          <Info size={16} />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className={cn('card pop-in z-50 p-3 text-xs shadow-xl', guide?.parts?.length ? 'w-80' : 'w-72')}
        >
          {guide && (
            <div className="space-y-1.5">
              <div className="font-semibold text-sm">{guide.name}</div>
              {guide.parts && guide.parts.length > 0 && (
                <div className="space-y-1 py-0.5">
                  {guide.parts.map((part) => (
                    <div key={part.label} className="flex items-baseline gap-2">
                      <span className="w-9 shrink-0 text-right font-mono text-[11px] font-semibold text-fg">
                        {part.weight}
                      </span>
                      <span className="shrink-0 font-medium text-fg">{part.label}</span>
                      <span className="text-muted">— {part.note}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-muted leading-relaxed">{guide.explanation}</p>
              <div className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] text-muted">
                {guide.formula}
              </div>
            </div>
          )}
          {extra && <div className={cn('text-muted leading-relaxed', guide && 'mt-2')}>{extra}</div>}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Modal dialog
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            'card pop-in fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(94vw,640px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5 shadow-2xl',
            className,
          )}
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="text-muted hover:text-fg transition-colors"
              >
                <X size={16} />
              </button>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Right-side sheet
// ---------------------------------------------------------------------------

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  /** width override, e.g. 'w-[min(94vw,560px)]' */
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            'sheet-in fixed right-0 top-0 z-50 h-full w-[min(94vw,440px)] overflow-y-auto border-l border-border bg-card p-5 shadow-2xl',
            className,
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="text-muted hover:text-fg transition-colors"
              >
                <X size={16} />
              </button>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  className,
}: {
  options: Array<{ id: T; label: ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  size?: 'xs' | 'sm';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border bg-bg p-0.5',
        className,
      )}
      role="tablist"
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={value === opt.id}
          onClick={() => onChange(opt.id)}
          className={cn(
            'rounded-md font-medium transition-colors',
            size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
            value === opt.id ? 'bg-card text-fg shadow-sm border border-border' : 'text-muted hover:text-fg',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Switch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'relative h-4.5 w-8 shrink-0 rounded-full border border-border transition-colors disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-fg/10',
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-[15px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Form field bits
// ---------------------------------------------------------------------------

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted/80">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 placeholder:text-muted/60';

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  type = 'button',
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'default' && 'border border-border bg-card hover:bg-bg',
        variant === 'primary' && 'bg-accent text-white hover:opacity-90',
        variant === 'danger' && 'border border-risk/40 text-risk hover:bg-risk/10',
        variant === 'ghost' && 'text-muted hover:text-fg hover:bg-fg/5',
        className,
      )}
    >
      {children}
    </button>
  );
}
