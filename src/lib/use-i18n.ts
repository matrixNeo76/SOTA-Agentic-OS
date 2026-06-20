'use client'

import { useState, useEffect, useCallback } from 'react'
import { type Lang, translations } from '@/lib/i18n'

/**
 * Hook per gestire la lingua corrente e tradurre le chiavi.
 * La lingua viene persistita in localStorage.
 */
export function useI18n() {
  const [lang, setLang] = useState<Lang>('it')

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('sota_lang') : null
    if (saved === 'it' || saved === 'en') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLang(saved)
    } else if (typeof window !== 'undefined') {
      const browserLang = navigator.language.slice(0, 2)
      if (browserLang === 'en') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLang('en')
      }
    }
  }, [])

  const changeLang = useCallback((newLang: Lang) => {
    setLang(newLang)
    if (typeof window !== 'undefined') {
      localStorage.setItem('sota_lang', newLang)
    }
  }, [])

  const t = useCallback((key: string): string => {
    return translations[lang]?.[key] || translations.en?.[key] || key
  }, [lang])

  return { lang, setLang: changeLang, t }
}
