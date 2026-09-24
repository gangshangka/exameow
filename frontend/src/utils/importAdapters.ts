import type { ColumnMapping } from './importParser'

export interface ImportAdapter {
  id: string
  label: string
  matches(headers: string[]): boolean
  mapping(headers: string[]): { columns: ColumnMapping; sourceIdColumn?: number }
  clean(text: string): string
}

const key = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '')

/** Keep plain readable text; parsed markup is never inserted into the live page. */
export function cleanExternalText(value: string): string {
  const raw = String(value ?? '').replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li|tr)>/gi, '\n')
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(raw, 'text/html')
    doc.querySelectorAll('script,style,iframe,svg').forEach(node => node.remove())
    return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
  }
  return raw.replace(/<[^>]*>/g, '').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&').trim()
}

const externalWrongAdapter: ImportAdapter = {
  id: 'external-wrong',
  label: '外部小程序错题',
  matches(headers) {
    const keys = new Set(headers.map(key))
    return ['序号', '题目', '题型', '答案', '解析', '选项a', '选项b'].every(name => keys.has(name))
  },
  mapping(headers) {
    const index = (name: string) => { const at = headers.findIndex(header => key(header) === name); return at < 0 ? null : at }
    const sourceIdColumn = index('序号') ?? undefined
    return { sourceIdColumn, columns: {
      stem: index('题目'), type: index('题型'), answer: index('答案'), analysis: index('解析'),
      options: ['a', 'b', 'c', 'd', 'e', 'f'].map(letter => index(`选项${letter}`)).filter((at): at is number => at !== null),
      combinedOptions: null, optionsDelimiter: '', subject: null, chapter: null, difficulty: null,
    } }
  },
  clean: cleanExternalText,
}

export const importAdapters: ImportAdapter[] = [externalWrongAdapter]
export function detectImportAdapter(headers: string[]): ImportAdapter | undefined {
  return importAdapters.find(adapter => adapter.matches(headers))
}
