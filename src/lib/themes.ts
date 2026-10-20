/**
 * 全局底色主题目录（换肤）
 *
 * 主题以 id 存储在两处：
 *  - 数据库 User.themeColor（跨设备、按账户持久化）
 *  - localStorage THEME_STORAGE_KEY（首屏渲染前内联脚本读取，避免闪色）
 *
 * 应用方式（CSS 变量，见 globals.css）：
 *  - --app-canvas        画布主色（纯色主题=色值；渐变主题=兜底纯色）
 *  - --app-canvas-image  渐变画布（linear-gradient(...)，纯色主题不设置）
 *  - --app-canvas-tint   卡片内浅色底（bg-canvas 槽位，取各主题的浅色版）
 *  - --app-canvas-panel  侧边栏 / 顶栏底色（主题同色系淡一号，如默认 #FDF9F1）
 *  - --app-nav-active    侧边栏选中项底色（主题同色系加深，白字可读）
 */

export interface ThemeDef {
  id: string
  /** 中文名（悬停提示 / 渐变卡标签） */
  label: string
  type: 'solid' | 'gradient'
  /** 纯色为色值；渐变为完整 linear-gradient(...) */
  css: string
  /** 兜底纯色（渐变主题用于加载态等纯色场景） */
  base: string
  /** 卡片内浅色底（原 bg-canvas 槽位使用的浅色版） */
  tint: string
  /** 侧边栏 / 顶栏底色（主题同色系淡一号） */
  panel: string
  /** 侧边栏选中项底色（主题同色系加深，白字可读） */
  accent: string
}

export const DEFAULT_THEME_ID = 'default'

/** localStorage 键名 */
export const THEME_STORAGE_KEY = 'investrack-theme'

export const THEMES: ThemeDef[] = [
  // ── 默认 ──
  { id: 'default', label: '默认奶油', type: 'solid', css: '#ECE3D4', base: '#ECE3D4', tint: '#ECE3D4', panel: '#FDF9F1', accent: '#A57627' },

  // ── 纯色（用户指定 16 色）──
  { id: 'c1', label: '雾松绿', type: 'solid', css: '#72A1AA', base: '#72A1AA', tint: '#E8F0F2', panel: '#DCE8EA', accent: '#338999' },
  { id: 'c2', label: '云雾白', type: 'solid', css: '#D6E1E6', base: '#D6E1E6', tint: '#F4F7F9', panel: '#F5F8F9', accent: '#337999' },
  { id: 'c3', label: '浅湖蓝', type: 'solid', css: '#90C8D9', base: '#90C8D9', tint: '#EAF5F8', panel: '#E3F1F6', accent: '#2788A5' },
  { id: 'c4', label: '晨雾蓝', type: 'solid', css: '#B8C9DA', base: '#B8C9DA', tint: '#F0F4F8', panel: '#EDF2F6', accent: '#336699' },
  { id: 'c5', label: '藏青夜', type: 'solid', css: '#404E74', base: '#404E74', tint: '#DDE1EC', panel: '#CFD3DC', accent: '#334E99' },
  { id: 'c6', label: '晴空蓝', type: 'solid', css: '#5297C0', base: '#5297C0', tint: '#E2EEF5', panel: '#D4E5EF', accent: '#2776A5' },
  { id: 'c7', label: '冰晶蓝', type: 'solid', css: '#C8DFE7', base: '#C8DFE7', tint: '#F0F7F9', panel: '#F1F7F9', accent: '#2785A5' },
  { id: 'c8', label: '石灰紫', type: 'solid', css: '#94909E', base: '#94909E', tint: '#ECEBEF', panel: '#E4E3E7', accent: '#503399' },
  { id: 'c9', label: '浅藤紫', type: 'solid', css: '#DCD7F7', base: '#DCD7F7', tint: '#F5F3FC', panel: '#F6F5FD', accent: '#3B27A5' },
  { id: 'c10', label: '墨松石', type: 'solid', css: '#122E37', base: '#122E37', tint: '#D6E3E7', panel: '#C4CBCD', accent: '#2786A5' },
  { id: 'c11', label: '香芋紫', type: 'solid', css: '#B398FF', base: '#B398FF', tint: '#F0EAFE', panel: '#ECE5FF', accent: '#4827A5' },
  { id: 'c12', label: '青碧', type: 'solid', css: '#02B7C4', base: '#02B7C4', tint: '#E0F7F9', panel: '#C0EDF0', accent: '#279DA5' },
  { id: 'c13', label: '樱粉', type: 'solid', css: '#FD84B0', base: '#FD84B0', tint: '#FEEAF2', panel: '#FFE0EB', accent: '#A52755' },
  { id: 'c14', label: '鸢尾紫', type: 'solid', css: '#8D77EA', base: '#8D77EA', tint: '#EBE6FA', panel: '#E3DDFA', accent: '#3F27A5' },
  { id: 'c15', label: '松绿', type: 'solid', css: '#167378', base: '#167378', tint: '#DCEEF0', panel: '#C5DCDD', accent: '#279FA5' },
  { id: 'c16', label: '宝蓝', type: 'solid', css: '#487ACF', base: '#487ACF', tint: '#E2EAF6', panel: '#D1DEF3', accent: '#2756A5' },

  // ── 渐变（源自 uiGradients / WebGradients / gradients.design 公开模版）──
  { id: 'g1', label: '青屿', type: 'gradient', css: 'linear-gradient(135deg, #085078, #85D8CE)', base: '#468EA3', tint: '#E3EEF1', panel: '#D4F1EE', accent: '#2778A5' },
  { id: 'g2', label: '极光', type: 'gradient', css: 'linear-gradient(135deg, #0ea5e9, #06b6d4, #8b5cf6)', base: '#35B3D5', tint: '#E4F4F8', panel: '#A8E5F0', accent: '#277EA5' },
  { id: 'g3', label: '凉蓝', type: 'gradient', css: 'linear-gradient(135deg, #2193b0, #6dd5ed)', base: '#47C4CF', tint: '#E4F3F5', panel: '#CCF0F9', accent: '#278CA5' },
  { id: 'g4', label: '暮海', type: 'gradient', css: 'linear-gradient(135deg, #2b5876, #4e4376)', base: '#3C4D76', tint: '#DEE2EC', panel: '#B5C5CF', accent: '#2F719D' },
  { id: 'g5', label: '靛紫', type: 'gradient', css: 'linear-gradient(135deg, #4f46e5, #a855f7)', base: '#7A4DEE', tint: '#EBE7FB', panel: '#E1C4FC', accent: '#2E27A5' },
  { id: 'g6', label: '智慧靛', type: 'gradient', css: 'linear-gradient(135deg, #B224EF, #7579FF)', base: '#944EF7', tint: '#EFE9FC', panel: '#CFD0FF', accent: '#7F27A5' },
  { id: 'g7', label: '翡翠水', type: 'gradient', css: 'linear-gradient(135deg, #348F50, #56B4D3)', base: '#45A1BF', tint: '#E4F1F0', panel: '#C4E5F0', accent: '#2F9D51' },
  { id: 'g8', label: '桃霞', type: 'gradient', css: 'linear-gradient(135deg, #fc5c7d, #6a82fb)', base: '#B36FBC', tint: '#F3E9F5', panel: '#CBD3FE', accent: '#A52741' },

  // ── 单色系渐变（同一色相 · 由浅到深）──
  { id: 'm1', label: '浅碧', type: 'gradient', css: 'linear-gradient(135deg, #B6DCEF, #167378)', base: '#66A2B1', tint: '#E3F1F4', panel: '#E5F3F9', accent: '#277BA5' },
  { id: 'm2', label: '黛青', type: 'gradient', css: 'linear-gradient(135deg, #719FAA, #122E37)', base: '#426572', tint: '#DFE9EC', panel: '#CDDDE1', accent: '#338599' },
  { id: 'm3', label: '湛蓝', type: 'gradient', css: 'linear-gradient(135deg, #A9C6E8, #487ACF)', base: '#7BA8DB', tint: '#E5EEF8', panel: '#E1EBF7', accent: '#2761A5' },
  { id: 'm4', label: '霁蓝', type: 'gradient', css: 'linear-gradient(135deg, #B8C9DA, #404E74)', base: '#7C8CA6', tint: '#E2E8EF', panel: '#E6ECF2', accent: '#336699' },
  { id: 'm5', label: '藤紫', type: 'gradient', css: 'linear-gradient(135deg, #DCD7F7, #8D77EA)', base: '#B4A7F0', tint: '#EEEBFA', panel: '#F3F1FC', accent: '#3B27A5' },
  { id: 'm6', label: '香芋', type: 'gradient', css: 'linear-gradient(135deg, #E3D6F5, #B398FF)', base: '#CBB7FA', tint: '#F1EBFD', panel: '#F5F1FC', accent: '#5C27A5' },
  { id: 'm7', label: '樱粉', type: 'gradient', css: 'linear-gradient(135deg, #FDD5E0, #FD84B0)', base: '#FDACC8', tint: '#FEEBF2', panel: '#FEF0F4', accent: '#A5274A' },
  { id: 'm8', label: '青碧', type: 'gradient', css: 'linear-gradient(135deg, #9FE8EC, #02B7C4)', base: '#51CDD7', tint: '#E4F6F7', panel: '#DDF7F8', accent: '#279FA5' },
]

/** 合法主题 id 白名单（API 校验用） */
export const THEME_IDS: readonly string[] = THEMES.map(t => t.id)

/** 按 id 取主题；不存在时回退默认 */
export function getThemeById(id: string | null | undefined): ThemeDef {
  return THEMES.find(t => t.id === id) || THEMES[0]
}

/** 客户端应用主题：写入 <html> 上的 CSS 变量 */
export function applyTheme(id: string | null | undefined) {
  if (typeof document === 'undefined') return
  const theme = getThemeById(id)
  const style = document.documentElement.style
  if (theme.type === 'gradient') {
    style.setProperty('--app-canvas', theme.base)
    style.setProperty('--app-canvas-image', theme.css)
  } else {
    style.setProperty('--app-canvas', theme.css)
    style.removeProperty('--app-canvas-image')
  }
  style.setProperty('--app-canvas-tint', theme.tint)
  style.setProperty('--app-canvas-panel', theme.panel)
  style.setProperty('--app-nav-active', theme.accent)
}

/**
 * 首屏防闪色脚本：在 <body> 顶部同步执行，
 * 从 localStorage 读取主题 id 并直接写入 CSS 变量（绘制前生效）。
 */
export function buildThemeBootstrapScript(): string {
  const map: Record<string, { b: string; g?: string; t: string; p: string; a: string }> = {}
  for (const t of THEMES) {
    map[t.id] =
      t.type === 'gradient'
        ? { b: t.base, g: t.css, t: t.tint, p: t.panel, a: t.accent }
        : { b: t.css, t: t.tint, p: t.panel, a: t.accent }
  }
  return `(function(){try{var M=${JSON.stringify(map)};var k=localStorage.getItem('${THEME_STORAGE_KEY}');var t=k&&M[k];if(!t)return;var s=document.documentElement.style;if(t.g){s.setProperty('--app-canvas',t.b);s.setProperty('--app-canvas-image',t.g)}else{s.setProperty('--app-canvas',t.b)}s.setProperty('--app-canvas-tint',t.t);s.setProperty('--app-canvas-panel',t.p);s.setProperty('--app-nav-active',t.a)}catch(e){}})()`
}
