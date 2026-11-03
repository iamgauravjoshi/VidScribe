interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      viewBox="0 0 32 32"
    >
      <rect fill="#B42318" height="30" rx="8" width="30" x="1" y="1" />
      <path
        d="M9.25 6.5h8.2l5.3 5.3v13.7h-13.5z"
        fill="none"
        stroke="#fff"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path d="M17.45 6.8v5h5" stroke="#fff" strokeWidth="1.6" />
      <path d="m12.5 14.1 6.2 3.5-6.2 3.5z" fill="#fff" />
    </svg>
  );
}
