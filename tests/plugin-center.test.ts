/**
 * 插件中心测试（P4 MVP + 二期）
 *
 * 覆盖：
 * - 受控目录：5 个检索渠道插件、查询模板、场景/模块清洗
 * - 运行时：安装/启停/升级/卸载、项目级启用、检索执行与去重、调用统计
 * - 提示词插件：创建校验 + 执行
 * - API：登录校验、管理员权限、目录查询、试运行
 * - 尽调接入：插件来源按模块归集并与既有 URL 去重
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'
import {
  PLUGIN_CATALOG,
  buildPluginQueries,
  getPluginManifest,
  resolvePluginByName,
  sanitizePluginModules,
  sanitizePluginScenes,
} from '@/lib/plugin-registry'
import {
  installPlugin,
  installPluginByName,
  uninstallPlugin,
  togglePlugin,
  setPluginScenes,
  setProjectPluginEnabled,
  createPromptPlugin,
  listPluginViews,
  runPlugin,
  collectPluginResearchSources,
} from '@/lib/plugin-runtime'
import { GET as PLUGIN_GET, POST as PLUGIN_POST } from '@/app/api/admin/plugins/route'
import { POST as PLUGIN_RUN } from '@/app/api/plugins/run/route'

const SUFFIX = String(Date.now()).slice(-6)
const ADMIN_EMAIL = `plugin-admin-${SUFFIX}@test.com`
const USER_EMAIL = `plugin-user-${SUFFIX}@test.com`

let adminId = ''
let userId = ''
let projectId = ''

beforeEach(async () => {
  resetMocks()
  await prisma.projectPlugin.deleteMany({})
  await prisma.agentPlugin.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: '插件测试' } } })
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, USER_EMAIL] } } })

  adminId = (await prisma.user.create({
    data: { email: ADMIN_EMAIL, name: '插件管理员', passwordHash: 'x', role: 'ADMIN', status: 'ACTIVE' },
  })).id
  userId = (await prisma.user.create({
    data: { email: USER_EMAIL, name: '普通投资经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  projectId = (await prisma.project.create({
    data: {
      name: '插件测试项目', companyFullName: '插件测试科技有限公司', industry: '工业AI',
      totalAmount: '3000万', targetDate: new Date(), createdById: adminId,
    },
  })).id
})

after(async () => {
  await prisma.projectPlugin.deleteMany({})
  await prisma.agentPlugin.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: '插件测试' } } })
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, USER_EMAIL] } } })
  await prisma.$disconnect()
})

function asAdmin() {
  mockState.session = { user: { id: adminId, name: '插件管理员', email: ADMIN_EMAIL, role: 'ADMIN' } }
}
function asUser() {
  mockState.session = { user: { id: userId, name: '普通投资经理', email: USER_EMAIL, role: 'INVESTMENT_MANAGER' } }
}

const req = (method: string, url: string, payload?: unknown) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

// ── 受控目录（纯函数） ──

test('目录：内置 6 个检索渠道插件，支持按名称/别名解析', () => {
  assert.equal(PLUGIN_CATALOG.length, 6)
  assert.deepEqual(PLUGIN_CATALOG.map(p => p.key), [
    'official-site', 'patent-search', 'bidding-search', 'news-monitor', 'financial-data', 'market-intel',
  ])
  const manifest = getPluginManifest('official-site')!
  const queries = buildPluginQueries(manifest, { name: '无涯智远', fullName: '无涯智远（北京）科技有限公司' })
  assert.equal(queries.length, 3)
  assert.ok(queries.every(q => q.includes('无涯智远')))

  assert.equal(buildPluginQueries(manifest, { name: '' }).length, 0)
  assert.deepEqual(sanitizePluginScenes(['dd-workbench', 'unknown']), ['dd-workbench'])
  assert.deepEqual(sanitizePluginModules(['FINANCE_ECONOMICS', 'BAD']), ['FINANCE_ECONOMICS'])

  // 名称/中文名/别名均可解析；dshmarket 映射到市场情报插件
  assert.equal(resolvePluginByName('official-site')!.key, 'official-site')
  assert.equal(resolvePluginByName('官网深读')!.key, 'official-site')
  assert.equal(resolvePluginByName('dshmarket')!.key, 'market-intel')
  assert.equal(resolvePluginByName('不存在的插件'), null)
})

// ── 运行时：安装/启停/项目级启用/卸载 ──

test('运行时：安装写入版本与统计行，启停与项目级启停生效，卸载清理项目覆盖', async () => {
  await installPlugin('official-site', adminId)
  let views = await listPluginViews(projectId)
  const view = views.find(v => v.key === 'official-site')!
  assert.equal(view.installed, true)
  assert.equal(view.installedVersion, '1.1.0')
  assert.equal(view.projectEnabled, true)

  await togglePlugin('official-site', false)
  views = await listPluginViews()
  assert.equal(views.find(v => v.key === 'official-site')!.isActive, false)

  await setProjectPluginEnabled(projectId, 'official-site', false)
  views = await listPluginViews(projectId)
  assert.equal(views.find(v => v.key === 'official-site')!.projectEnabled, false)
  assert.equal(views.find(v => v.key === 'official-site')!.projectOverride, false)

  await uninstallPlugin('official-site')
  assert.equal(await prisma.projectPlugin.count({ where: { pluginKey: 'official-site' } }), 0)
  views = await listPluginViews()
  assert.equal(views.find(v => v.key === 'official-site')!.installed, false)
})

test('运行时：按名称安装（dshmarket）与按插件配置参与功能', async () => {
  const byName = await installPluginByName('dshmarket', userId)
  assert.equal(byName.key, 'market-intel')
  assert.equal(byName.alreadyInstalled, false)

  const again = await installPluginByName('市场情报', userId)
  assert.equal(again.alreadyInstalled, true)

  await setPluginScenes('market-intel', ['project-interpretation'])
  const view = (await listPluginViews()).find(v => v.key === 'market-intel')!
  assert.deepEqual(view.scenes, ['project-interpretation'])

  await assert.rejects(() => installPluginByName('不存在的插件'), /未找到插件/)
})

// ── 执行：检索插件与提示词插件 ──

test('执行：检索插件双源去重、写入来源与调用统计；提示词插件返回 summary', async () => {
  await installPlugin('patent-search')
  mockState.searchDefault = [
    { title: '专利检索结果', url: 'https://example.com/patent?utm_source=x', content: '一种工业质检方法专利' },
  ]
  const result = await runPlugin('patent-search', '', {
    project: { name: '无涯智远', companyFullName: '无涯智远（北京）科技有限公司' },
  })
  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].url, 'https://example.com/patent')
  const row = await prisma.agentPlugin.findUnique({ where: { key: 'patent-search' } })
  assert.equal(row!.runCount, 1)
  assert.equal(row!.successCount, 1)

  await createPromptPlugin({
    key: 'deal-view', name: '交易视角', description: '从并购退出视角分析', content: '你是并购退出专家，请输出 JSON {"summary":"结论"}。', scenes: ['ai-research'],
  })
  mockState.fetchHandler = () => chatCompletions(JSON.stringify({ summary: '建议关注产业方接盘机会。' }))
  const promptResult = await runPlugin('deal-view', '无涯智远 工业AI质检')
  assert.equal(promptResult.ok, true)
  assert.match(promptResult.summary, /产业方/)
})

test('执行：未安装插件不可运行', async () => {
  await assert.rejects(() => runPlugin('news-monitor', '某公司'), /尚未安装/)
})

// ── 尽调接入：来源按模块归集 + 共用去重 ──

test('尽调接入：插件来源按首模块归集，与既有来源共用 URL 去重', async () => {
  await installPlugin('financial-data')
  mockState.searchDefault = [
    { title: '财务报道', url: 'https://example.com/fin', content: '营收增长与毛利率数据' },
    { title: '重复来源', url: 'https://example.com/fin/', content: '重复内容' },
  ]
  const seenUrls = new Set<string>()
  const { sourcesByModule, pluginRuns } = await collectPluginResearchSources(
    { id: projectId, name: '插件测试项目', companyFullName: '插件测试科技有限公司', industry: '工业AI' },
    { seenUrls }
  )
  assert.equal(sourcesByModule.FINANCE_ECONOMICS.length, 1)
  assert.equal(sourcesByModule.FINANCE_ECONOMICS[0].url, 'https://example.com/fin')
  assert.equal(pluginRuns[0].sourceCount, 1)
  assert.ok(seenUrls.has('https://example.com/fin'))

  // 第二轮：同一批 URL 已被占用，不再重复产出
  const second = await collectPluginResearchSources(
    { id: projectId, name: '插件测试项目' },
    { seenUrls }
  )
  assert.equal(second.sourcesByModule.FINANCE_ECONOMICS, undefined)
})

// ── API：权限与契约 ──

test('API：未登录 401；普通账号可读目录、可安装与配置参与功能，但不可卸载', async () => {
  mockState.session = null
  assert.equal((await PLUGIN_GET(req('GET', 'http://t/api/admin/plugins'))).status, 401)

  asUser()
  const read = await PLUGIN_GET(req('GET', 'http://t/api/admin/plugins'))
  assert.equal(read.status, 200)
  const readBody = await read.json()
  assert.equal(readBody.plugins.length, 6)
  assert.ok(Array.isArray(readBody.projects))
  assert.equal(readBody.stats.installed, 0)

  // 普通账号可以直接安装，并配置该插件参与的功能
  const installed = await PLUGIN_POST(req('POST', 'http://t/api/admin/plugins', { action: 'install', key: 'official-site' }))
  assert.equal(installed.status, 200)
  const scenes = await PLUGIN_POST(req('POST', 'http://t/api/admin/plugins', {
    action: 'scenes', key: 'official-site', scenes: ['project-interpretation'],
  }))
  assert.equal(scenes.status, 200)

  // 卸载仍仅管理员可操作
  const denied = await PLUGIN_POST(req('POST', 'http://t/api/admin/plugins', { action: 'uninstall', key: 'official-site' }))
  assert.equal(denied.status, 403)

  const after = await (await PLUGIN_GET(req('GET', 'http://t/api/admin/plugins'))).json()
  assert.equal(after.stats.installed, 1)
  assert.deepEqual(after.plugins.find((p: { key: string }) => p.key === 'official-site').scenes, ['project-interpretation'])
})

test('API：按名称安装 dshmarket 自动安装市场情报插件', async () => {
  asUser()
  const res = await PLUGIN_POST(req('POST', 'http://t/api/admin/plugins', { action: 'installByName', name: 'dshmarket' }))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.key, 'market-intel')
  assert.equal(body.name, '市场情报')
  assert.equal(body.alreadyInstalled, false)
})

test('API：管理员创建提示词插件；试运行接口返回来源', async () => {
  asAdmin()
  const created = await PLUGIN_POST(req('POST', 'http://t/api/admin/plugins', {
    action: 'create', key: 'exit-path', name: '退出路径', description: '分析退出路径',
    content: '你是退出路径专家，请输出 JSON {"summary":"结论"}。', scenes: ['ai-research'],
  }))
  assert.equal(created.status, 201)
  const createdRow = await prisma.agentPlugin.findUnique({ where: { key: 'exit-path' } })
  assert.equal(createdRow!.kind, 'PROMPT')

  asUser()
  mockState.fetchHandler = () => chatCompletions(JSON.stringify({ summary: '存在产业并购退出机会。' }))
  const run = await PLUGIN_RUN(req('POST', 'http://t/api/plugins/run', { key: 'exit-path', input: '无涯智远' }))
  assert.equal(run.status, 200)
  const runBody = await run.json()
  assert.match(runBody.result.summary, /并购/)
})
