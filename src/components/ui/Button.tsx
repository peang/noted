import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium select-none cursor-pointer whitespace-nowrap ' +
  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-border-hover';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-theme-white text-theme-bg hover:opacity-90',
  secondary: 'bg-theme-active text-theme-text border border-theme-border hover:bg-theme-hover hover:border-theme-border-hover',
  ghost: 'text-theme-muted hover:text-theme-white hover:bg-theme-hover',
  danger: 'text-red-500 hover:bg-red-500/10',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'secondary', size = 'sm', className = '', type = 'button', ...rest }: ButtonProps) {
  const sizeClass = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-xs';
  return <button type={type} className={`${BASE} ${VARIANTS[variant]} ${sizeClass} ${className}`} {...rest} />;
}

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  // Shown as tooltip and read by screen readers; icon-only buttons need it
  label: string;
  variant?: ButtonVariant;
  active?: boolean;
}

export function IconButton({ label, variant = 'ghost', active = false, className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={`${BASE} ${VARIANTS[variant]} h-7 w-7 shrink-0 ${active ? 'bg-theme-hover text-theme-white' : ''} ${className}`}
      {...rest}
    />
  );
}
