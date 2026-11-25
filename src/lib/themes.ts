export type UiDesignId = 'obsidian' | 'paper' | 'nordic' | 'monochrome';
export type SurfaceRadius = 'sharp' | 'balanced' | 'soft';
export type DesktopLayoutMode = 'standard' | 'focus';

export interface UiDesignDefinition {
  id: UiDesignId;
  name: string;
  mode: 'dark' | 'light';
  summary: string;
  swatches: {
    canvas: string;
    surface: string;
    accent: string;
    text: string;
  };
}

export const UI_DESIGNS: UiDesignDefinition[] = [
  {
    id: 'obsidian',
    name: 'Obsidian Studio',
    mode: 'dark',
    summary: 'Deep slate obsidian canvas with electric cobalt highlights.',
    swatches: {
      canvas: '#0b0f17',
      surface: '#111827',
      accent: '#2563eb',
      text: '#f1f5f9',
    },
  },
  {
    id: 'paper',
    name: 'Paper Daylight',
    mode: 'light',
    summary: 'High-legibility alabaster studio optimized for bright daylight.',
    swatches: {
      canvas: '#f4f6f9',
      surface: '#ffffff',
      accent: '#4338ca',
      text: '#0f172a',
    },
  },
  {
    id: 'nordic',
    name: 'Nordic Frost',
    mode: 'dark',
    summary: 'Cool arctic charcoal panels with glacier cyan accents.',
    swatches: {
      canvas: '#10161f',
      surface: '#192332',
      accent: '#0284c7',
      text: '#ecf3fa',
    },
  },
  {
    id: 'monochrome',
    name: 'Monochrome Terminal',
    mode: 'dark',
    summary: 'High-contrast carbon workspace with crisp amber signal accents.',
    swatches: {
      canvas: '#09090b',
      surface: '#151519',
      accent: '#d97706',
      text: '#fafafa',
    },
  },
];

export function getUiDesign(id: string): UiDesignDefinition {
  return UI_DESIGNS.find((d) => d.id === id) || UI_DESIGNS[0];
}
