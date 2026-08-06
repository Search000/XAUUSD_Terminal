import { twMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getAutoSession(): "Asia" | "London" | "New York" {
  const hour = new Date().getUTCHours();
  if (hour >= 8 && hour < 13) return "London";
  if (hour >= 13 && hour < 22) return "New York";
  return "Asia"; // 22:00–07:59 UTC
}

export function formatCurrency(value: number, decimals: number = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatNumber(value: number, decimals: number = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number, decimals: number = 2) {
  return `${value >= 0 ? '+' : ''}${formatNumber(value, decimals)}%`;
}
