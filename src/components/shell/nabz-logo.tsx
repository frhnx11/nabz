/** The Nabz wordmark: a small pulse line running into thin N Λ B Z letters. */
export function NabzLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 104 28"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M1 23h8l2-4 2 4h7V5l16 18V5" />
      <path d="M42 23 50 5l8 18" />
      <path d="M64 14V5h8a4.5 4.5 0 0 1 0 9h-8v9h9a4.5 4.5 0 0 0 0-9" />
      <path d="M86 5h16L86 23h16" />
    </svg>
  );
}
