interface StatusDotProps {
  /** Set to false for a static dot (no ring animation). */
  pulse?: boolean
}

export function StatusDot({ pulse = true }: StatusDotProps) {
  return (
    <span className="relative inline-flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
      {pulse && (
        <span className="absolute inset-0 rounded-full bg-live/70 motion-safe:animate-ping-soft" />
      )}
      <span className="relative size-2 rounded-full bg-live shadow-[0_0_10px_0_var(--color-live)]" />
    </span>
  )
}
