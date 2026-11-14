import type { HighlightCaptionItem, SupportedLanguage } from '../types/repurposer';

export interface LanguageOption {
  id: SupportedLanguage;
  label: string;
  nativeLabel: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: 'en', label: 'English', nativeLabel: 'English' },
  { id: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { id: 'bn', label: 'Bengali', nativeLabel: 'বাংলা' },
];

export function getLanguageLabel(lang: SupportedLanguage): string {
  return LANGUAGE_OPTIONS.find((opt) => opt.id === lang)?.label ?? 'English';
}

export function getEffectiveCaptionContent(
  item: HighlightCaptionItem,
  selectedLanguage: SupportedLanguage
): {
  title: string;
  caption: string;
  hashtags: string[];
  language: SupportedLanguage;
  isTranslated: boolean;
} {
  if (selectedLanguage !== 'en') {
    const translated = item.translations?.[selectedLanguage];
    if (translated) {
      return {
        title: translated.title,
        caption: translated.caption,
        hashtags: translated.hashtags,
        language: selectedLanguage,
        isTranslated: true,
      };
    }
  }

  return {
    title: item.title,
    caption: item.voiceCaption,
    hashtags: item.hashtags,
    language: 'en',
    isTranslated: false,
  };
}
