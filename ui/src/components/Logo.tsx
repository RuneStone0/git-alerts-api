import React from 'react';

interface LogoProps {
  className?: string;
  /** Accessible name. Pass null beside a wordmark, where the text already names the product. */
  title?: string | null;
}

/**
 * The GitAlerts mark: a shield with the alert cut out as a hole, drawn as one
 * compound path in a single fill. Because it inherits `currentColor`, colour it
 * with a text utility (text-brand, text-primary) and light/dark needs no override.
 *
 * Geometry matches ui/public/favicon.svg on the same 64-unit grid; keep them in step.
 */
export const Logo: React.FC<LogoProps> = ({ className = 'h-8 w-8', title = 'GitAlerts' }) => (
  <svg
    viewBox="0 0 64 64"
    className={className}
    fill="currentColor"
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : true}
  >
    {title ? <title>{title}</title> : null}
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.8 13.6C6.8 12.3 7.6 11.2 8.8 10.7L30.8 3.1C31.6 2.8 32.4 2.8 33.2 3.1L55.2 10.7C56.4 11.2 57.2 12.3 57.2 13.6V31.2C57.2 44.9 46.2 56.3 32 61.4C17.8 56.3 6.8 44.9 6.8 31.2ZM28.8 21.4a3.2 3.2 0 0 1 6.4 0v13.8a3.2 3.2 0 0 1-6.4 0zM32 39.5a4.1 4.1 0 1 1 0 8.2a4.1 4.1 0 0 1 0-8.2z"
    />
  </svg>
);
