"use client";

import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectFilterProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Extra classes for the <select> itself (e.g. a 44 px height on a mobile-first page). */
  selectClassName?: string;
  id?: string;
  label?: string;
  disabled?: boolean;
}

export function SelectFilter({
  options,
  value,
  onChange,
  placeholder,
  className,
  selectClassName,
  id,
  label,
  disabled,
}: SelectFilterProps) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground mb-1 block">
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer hover:border-primary/50 transition-colors disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-input",
          selectClassName
        )}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
