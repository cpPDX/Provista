type NavIconName = 'home' | 'plan' | 'list' | 'pantry' | 'more';

export function NavIcon({ name }: { name: NavIconName }) {
  if (name === 'home') {
    return (
      <svg data-nav-icon={name} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 10.5 12 3l8.5 7.5" />
        <path d="M5.5 9.5V21h13V9.5" />
        <path d="M9.5 21v-6h5v6" />
      </svg>
    );
  }

  if (name === 'plan') {
    return (
      <svg data-nav-icon={name} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M7.5 3v4M16.5 3v4M3.5 9h17" />
        <path d="m8 14 2 2 5-5" />
      </svg>
    );
  }

  if (name === 'list') {
    return (
      <svg data-nav-icon={name} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
        <path d="M9 3.5h6v3H9zM8.5 11h.01M11.5 11H16M8.5 15h.01M11.5 15H16" />
      </svg>
    );
  }

  if (name === 'pantry') {
    return (
      <svg data-nav-icon={name} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
        <path d="M4 11h16M8 7h3M8 15h3M15 15h1" />
      </svg>
    );
  }

  return (
    <svg data-nav-icon={name} viewBox="0 0 24 24" aria-hidden="true" className="shell-nav-more-icon">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}
