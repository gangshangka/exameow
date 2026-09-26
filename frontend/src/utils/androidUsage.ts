import { isAndroid, isTauri } from './platform'

export interface AppUsage { packageName: string; label: string; minutes: number; date: string }
export const usageAvailable = () => isTauri() && isAndroid()

async function call<T>(method: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(`plugin:studytools|${method}`, args)
}
export async function hasUsageAccess(): Promise<boolean> {
  if (!usageAvailable()) return false
  return (await call<{ granted: boolean }>('has_usage_access')).granted
}
export async function openUsageAccessSettings(): Promise<void> {
  if (usageAvailable()) await call('open_usage_access_settings')
}
export async function getAndroidUsage(days: number): Promise<AppUsage[]> {
  if (!usageAvailable()) return []
  const result = await call<{ apps: AppUsage[] }>('get_usage_stats', { days })
  return Array.isArray(result.apps) ? result.apps : []
}
export async function takePendingSelectedText(): Promise<string | null> {
  if (!usageAvailable()) return null
  const result = await call<{ text?: string | null }>('take_selected_text')
  return result.text?.trim() || null
}
