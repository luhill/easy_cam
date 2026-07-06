export type UiTheme = 'dark' | 'light';

export interface ViewerThemeColors {
  background: string;
  gridCell: string;
  gridSection: string;
  viewer2dBackground: string;
  viewer2dGrid: string;
  viewer2dAxis: string;
  viewer2dLabel: string;
  ambientLight: number;
  keyLight: number;
  fillLight: number;
}

export const VIEWER_THEME: Record<UiTheme, ViewerThemeColors> = {
  dark: {
    background: '#0f1115',
    gridCell: '#2a2f38',
    gridSection: '#3d4555',
    viewer2dBackground: '#0f1115',
    viewer2dGrid: '#222831',
    viewer2dAxis: '#3d4555',
    viewer2dLabel: '#94a3b8',
    ambientLight: 0.5,
    keyLight: 1.2,
    fillLight: 0.4,
  },
  light: {
    background: '#e8ecf1',
    gridCell: '#c5ccd6',
    gridSection: '#9aa5b5',
    viewer2dBackground: '#e8ecf1',
    viewer2dGrid: '#d1d8e2',
    viewer2dAxis: '#9aa5b5',
    viewer2dLabel: '#64748b',
    ambientLight: 0.85,
    keyLight: 1.05,
    fillLight: 0.55,
  },
};

export function viewerThemeColors(theme: UiTheme): ViewerThemeColors {
  return VIEWER_THEME[theme];
}
