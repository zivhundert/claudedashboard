import { countryFlag, countryName } from '@dash/shared';
import { cn } from '@/lib/utils';

/** The member's location as a flag emoji with the country name on hover; nothing when unset. */
export function CountryFlag({
  code,
  className,
  size = 'sm',
}: {
  code: string | null | undefined;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const flag = countryFlag(code);
  if (!flag) return null;
  const name = countryName(code) ?? code ?? '';
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn('inline-block shrink-0 leading-none', size === 'md' ? 'text-base' : 'text-[13px]', className)}
    >
      {flag}
    </span>
  );
}
