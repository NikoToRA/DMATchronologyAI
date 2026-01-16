'use client';

import { type ReactNode } from 'react';

// Loading Spinner
interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  return (
    <div
      className={`animate-spin rounded-full border-2 border-gray-300 border-t-primary-600 ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label="読み込み中"
    />
  );
}

// Loading placeholder for page content
interface LoadingPlaceholderProps {
  message?: string;
}

export function LoadingPlaceholder({ message = '読み込み中...' }: LoadingPlaceholderProps) {
  return (
    <div className="text-center py-12 text-gray-500">
      {message}
    </div>
  );
}

// Empty State component
interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12 bg-white rounded-lg shadow">
      {icon && (
        <div className="flex justify-center mb-4">
          {icon}
        </div>
      )}
      <p className="text-gray-500">{title}</p>
      {description && (
        <p className="text-sm text-gray-400 mt-1">{description}</p>
      )}
      {action && (
        <div className="mt-4">
          {action}
        </div>
      )}
    </div>
  );
}

// Inline loading state for table cells or small sections
interface InlineLoadingProps {
  message?: string;
}

export function InlineLoading({ message = '読み込み中...' }: InlineLoadingProps) {
  return (
    <div className="p-8 text-center text-gray-500">
      {message}
    </div>
  );
}
