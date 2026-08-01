// Design tokens extracted from the LoopedIn style reference (lupus-in.vercel.app).
export const SIDEBAR_BG = '#2B123E';
export const SIDEBAR_TEXT = '#D7ECFA';
export const SIDEBAR_TEXT_ACTIVE = '#F7FBFF';
export const SIDEBAR_ACTIVE_BG = 'rgba(215, 236, 250, 0.15)';

export const BRAND_PURPLE = '#43205F';
export const BRAND_PURPLE_DARK = '#2B123E';

export const TEXT_DARK = '#1F2430';
export const TEXT_MUTED = '#4F5E70';
export const BORDER = '#CCDCE9';
export const PAGE_BG = '#F6F8FB';

export interface BadgeTone {
  bg: string;
  color: string;
  border: string;
}

export const BADGE_TONES: Record<'info' | 'success' | 'neutral' | 'danger' | 'purple', BadgeTone> = {
  info: { bg: '#EDF7FD', color: '#245D86', border: '#C5E3F5' },
  success: { bg: '#EAF5EE', color: '#2F7A4C', border: '#BFDCC9' },
  neutral: { bg: '#EEF2F6', color: '#4F5E70', border: '#DCE4EC' },
  danger: { bg: '#FDF0F2', color: '#B03052', border: '#F3CBD5' },
  purple: { bg: '#F7F2FA', color: '#5B2A7D', border: '#E4D3ED' },
};

export interface StatAccent {
  border: string;
  bg: string;
  text: string;
}

export const STAT_ACCENTS: Record<'purple' | 'blue' | 'green' | 'rose', StatAccent> = {
  purple: { border: '#5B2A7D', bg: '#FBF9FC', text: '#5B2A7D' },
  blue: { border: '#4D94C5', bg: '#F7FBFE', text: '#245D86' },
  green: { border: '#4F9468', bg: '#F8FCF9', text: '#2F7A4C' },
  rose: { border: '#B45B70', bg: '#FFF9FA', text: '#B03052' },
};
