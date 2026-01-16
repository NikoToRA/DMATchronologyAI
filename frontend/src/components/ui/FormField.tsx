'use client';

import { type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode, forwardRef } from 'react';

// Common input classes
const INPUT_BASE_CLASSES =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

// Form Label
interface LabelProps {
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}

export function Label({ htmlFor, required, children }: LabelProps) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">
      {children}
      {required && ' *'}
    </label>
  );
}

// Text Input with label
interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ label, required, id, className = '', ...props }, ref) {
    return (
      <div>
        {label && (
          <Label htmlFor={id} required={required}>
            {label}
          </Label>
        )}
        <input
          ref={ref}
          id={id}
          required={required}
          className={`${INPUT_BASE_CLASSES} ${className}`}
          {...props}
        />
      </div>
    );
  }
);

// Password Input
interface PasswordInputProps extends Omit<TextInputProps, 'type'> {}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(props, ref) {
    return <TextInput ref={ref} type="password" {...props} />;
  }
);

// Select Input with label
interface SelectOption {
  value: string;
  label: string;
}

interface SelectInputProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  options: readonly SelectOption[];
}

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(
  function SelectInput({ label, required, id, options, className = '', ...props }, ref) {
    return (
      <div>
        {label && (
          <Label htmlFor={id} required={required}>
            {label}
          </Label>
        )}
        <select
          ref={ref}
          id={id}
          required={required}
          className={`${INPUT_BASE_CLASSES} ${className}`}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
);

// Inline edit input (for tables)
interface InlineInputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const InlineInput = forwardRef<HTMLInputElement, InlineInputProps>(
  function InlineInput({ className = '', ...props }, ref) {
    return (
      <input
        ref={ref}
        className={`w-full px-2 py-1 border border-gray-300 rounded ${className}`}
        {...props}
      />
    );
  }
);

// Inline edit select (for tables)
interface InlineSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: readonly SelectOption[];
}

export const InlineSelect = forwardRef<HTMLSelectElement, InlineSelectProps>(
  function InlineSelect({ options, className = '', ...props }, ref) {
    return (
      <select
        ref={ref}
        className={`w-full px-2 py-1 border border-gray-300 rounded ${className}`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
);

// Checkbox with label
interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, id, className = '', ...props }, ref) {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          ref={ref}
          type="checkbox"
          id={id}
          className={`rounded ${className}`}
          {...props}
        />
        {label}
      </label>
    );
  }
);
