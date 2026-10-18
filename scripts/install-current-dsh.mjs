import fs from 'node:fs'
import path from 'node:path'

const profile = path.join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop')
const src = 'C:\\Users\\40410\\Desktop\\context\\plugin-skeleton'
const dest = path.join(profile, 'node_modules', 'ctx-mon-and-con')
const pkgPath = path.join(profile, 'package.json')

// 1) 备份 package.json
const raw = fs.readFileSync(pkgPath, 'utf8')
fs.writeFileSync(pkgPath + '.ctx-backup', raw, 'utf8')

// 2) 复制插件到 profile node_modules（不跑 pnpm，避免扰动正在运行的 app）
fs.rmSync(dest, { recursive: true, force: true })
fs.cpSync(src, dest, {
  recursive: true,
  filter: (from) => !from.includes(`${path.sep}test${path.sep}deps`) && !from.includes(`${path.sep}.git${path.sep}`),
})

// 3) 注册依赖 + bundle
const pkg = JSON.parse(raw)
pkg.dependencies = pkg.dependencies || {}
pkg.dependencies['ctx-mon-and-con'] = 'link:C:/Users/40410/Desktop/context/plugin-skeleton'
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
if (!pkg.dsh.profile.bundles.includes('ctx-mon-and-con')) pkg.dsh.profile.bundles.push('ctx-mon-and-con')
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

console.log(JSON.stringify({
  profile,
  destExists: fs.existsSync(path.join(dest, 'package.json')),
  destVersion: JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).version,
  dependency: pkg.dependencies['ctx-mon-and-con'],
  bundles: pkg.dsh.profile.bundles,
  backup: pkgPath + '.ctx-backup',
}, null, 2))
