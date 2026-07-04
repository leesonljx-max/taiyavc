/**
 * 计算本周起始时间（每周一中午12:00为刷新点）
 * 如果今天是周一且还没到12:00，则上周一12:00为本周起始
 */
export function getWeekStart(): Date {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysSinceMonday)
  monday.setHours(12, 0, 0, 0)
  if (dayOfWeek === 1 && now.getHours() < 12) {
    monday.setDate(monday.getDate() - 7)
  }
  return monday
}
