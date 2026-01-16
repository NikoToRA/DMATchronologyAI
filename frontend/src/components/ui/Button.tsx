'use client';

import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { type LucideIcon } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  isLoading?: boolean;
  children?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700',
  secondary: 'text-gray-700 hover:bg-gray-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-gray-500 hover:bg-gray-100',
  success: 'bg-green-600 text-white hover:bg-green-700',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2',
  lg: 'px-6 py-3 text-lg',
  icon: 'p-1',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      icon: Icon,
      iconPosition = 'left',
      isLoading = false,
      disabled,
      className = '',
      children,
      ...props
    },
    ref
  ) {
    const isDisabled = disabled || isLoading;
    const baseClasses =
      'inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

    const iconSize = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {isLoading ? (
          <span className={`animate-spin ${iconSize}`}>...</span>
        ) : (
          <>
            {Icon && iconPosition === 'left' && <Icon className={iconSize} />}
            {children}
            {Icon && iconPosition === 'right' && <Icon className={iconSize} />}
          </>
        )}
      </button>
    );
  }
);

// Icon Button for actions
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  variant?: 'primary' | 'danger' | 'success' | 'ghost';
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ icon: Icon, variant = 'ghost', label, className = '', ...props }, ref) {
    const variantIconClasses: Record<string, string> = {
      primary: 'text-primary-600 hover:bg-primary-50',
      danger: 'text-red-600 hover:bg-red-50',
      success: 'text-green-600 hover:bg-green-50',
      ghost: 'text-gray-500 hover:bg-gray-100',
    };

    return (
      <button
        ref={ref}
        className={`p-1 rounded ${variantIconClasses[variant]} ${className}`}
        title={label}
        aria-label={label}
        {...props}
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }
);

// Link-styled button
interface LinkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export const LinkButton = forwardRef<HTMLButtonElement, LinkButtonProps>(
  function LinkButton({ className = '', children, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={`text-primary-600 hover:text-primary-800 ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);
