'use client';

import { type ReactNode } from 'react';
import {
  type SessionStatus,
  type ChronologyCategory,
  SESSION_STATUS_CONFIGS,
  CATEGORY_CONFIGS,
} from '@/lib/types';

// Base Badge component
interface BadgeProps {
  className?: string;
  children: ReactNode;
}

export function Badge({ className = '', children }: BadgeProps) {
  return (
    <span
      className={`px-2 py-1 rounded-full text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

// Session Status Badge
interface StatusBadgeProps {
  status: SessionStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = SESSION_STATUS_CONFIGS[status];
  return (
    <Badge className={config.className}>
      {config.label}
    </Badge>
  );
}

// Chronology Category Badge
interface CategoryBadgeProps {
  category: ChronologyCategory;
}

export function CategoryBadge({ category }: CategoryBadgeProps) {
  const config = CATEGORY_CONFIGS[category];
  return (
    <Badge className={config.className}>
      {category}
    </Badge>
  );
}

// Active/Inactive Status Badge
interface ActiveBadgeProps {
  active: boolean;
}

export function ActiveBadge({ active }: ActiveBadgeProps) {
  return (
    <Badge className={active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
      {active ? '有効' : '無効'}
    </Badge>
  );
}

// Connection Status Badge
interface ConnectionBadgeProps {
  status: '参加中' | '退出';
}

export function ConnectionBadge({ status }: ConnectionBadgeProps) {
  const isConnected = status === '参加中';
  return (
    <Badge className={isConnected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
      {status}
    </Badge>
  );
}

// Identification Status Badge
interface IdentificationBadgeProps {
  status: '確定' | '未確定';
}

export function IdentificationBadge({ status }: IdentificationBadgeProps) {
  const isConfirmed = status === '確定';
  return (
    <Badge className={isConfirmed ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}>
      {status}
    </Badge>
  );
}
